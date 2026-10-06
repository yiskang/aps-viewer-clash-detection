# G2 Diagnostic Instrumentation: Specification (diagnostic schema, correlation, fail-closed rules, bounds, sufficiency experiment)

> **Status and limits. Read these first.**
> - This is a **diagnostic-research specification**. It is **not** an acceptance-procedure amendment and does **not** change the accepted G2 procedure (SHA-256 `d1ccfde224b8ae76fe74b06c93abc532e6df9612933cafaa045053c8e2e45a75`) or the acceptance contract.
> - It is **not a settle rule**. It proposes no T4 algorithm, threshold, or margin.
> - It makes **no T4, C6/N2, or C8 change**. Real T4 runtime behaviour, C6 `NOT_EVIDENCED`, historical G2 `FAIL (row 3)` and the unresolved historical C8 all stay as they are.
> - Nothing here is an **acceptance or production dependency**. Version-bound Viewer 7.124.2 internals are diagnostic/research-only, and using one in production or acceptance would require procedure re-acceptance.
> - **No live run is authorized.** That covers Viewer, browser, live diagnostic, G2 retry, new authorization record and attempt reset. §6 describes what a *future, separately authorized* diagnostic would have to satisfy. Only the offline prototype (§7–§8) is in scope for this package.
> - Historical C8 causality stays **unresolved**. D2 support is **synthetic only**.

- **Authority:** `docs/prompts/for-claude-g2-diagnostic-instrumentation-research-to-ready-package.md` §6–§12.
- **Baseline:** `main` @ `06980ee1e17b1268d4028ed9951c5f8462016cd2`. Harness SHA-256 `cc8868cd68b9c2c3382297070289a2aa165c74249c6d82896d76bacc6c6ef09b`.
- **Companion research:** [`2026-10-05-g2-diagnostic-instrumentation-research.md`](2026-10-05-g2-diagnostic-instrumentation-research.md), cited as "R §n". Hypotheses are DH-1…DH-10 (R §3). Observables are O-1…O-29 (R §4). Version-bound dependencies are VB-0…VB-9 (R §6).
- **Labels:** the same as R §1 ([SRC] [DOC] [EVD] [HAR] [SYN] [INF] [UNKNOWN]). Normative text uses MUST, MUST NOT and MAY.

---

## 1. Scope

1. Define a bounded diagnostic **event schema** (§6.1) with only the fields the research justifies, each field tagged with a source class.
2. Define a **correlation model** (§6.2) and **fail-closed semantics** (§6.3).
3. Fix **hard numeric bounds** (§6.4) and **evidence-integrity rules** (§6.5).
4. Specify the **offline prototype** and the **sufficiency experiment** (§7–§8) that fill R §8–§10.

Section numbers §6–§8 follow the authority prompt (§6 specification, §7 prototype, §8 experiment). §2–§5 are intentionally unused here because the research content lives in R.

Source classes used on every field and event kind:

| Class | Tag | Meaning |
|---|---|---|
| public | `PUB` | Documented Viewer API/event. `PUB†` means existence is public but the fine semantics relied on are version-bound (VB-9). |
| version-bound | `VB7124` | Undocumented 7.124.2 internal, read-only, behind the VB-0 guard (R §6). |
| harness-tagged | `HAR` | Created by diagnostic-harness call-site instrumentation, such as tokens, settle ids, frame counters, relative times and classing. It is never a Viewer signal. |
| synthetic | `SYN` | Exists only in the D2 offline model (ground-truth tags). It never appears in a live trace. |

**Request identity is `HAR` only.** The Viewer carries no request identifier on the navigation path [SRC] (R §4 fact 1). No field, rule or output of this spec may state or imply that the Viewer supplies request identity.

---

## 6. Diagnostic specification

### 6.1 Diagnostic event schema

One trace is an ordered array of **DiagEvent** records, serialized as canonical JSON with D2 conventions (UTF-8, sorted keys, no insignificant whitespace, no trailing newline; `docs/research/2026-10-04-g2-d2-synthetic-transition/canonical.mjs`). Keys are short to respect §6.4. Fields that are absent are **omitted**, never `null`, unless the table below says otherwise.

#### 6.1.1 Event kinds

| `k` (kind) | Atom (§8.3) | Class | Emitted when | Justification |
|---|---|---|---|---|
| `FIT` | `H-CALL` (base) | HAR (+ `FIT_TO_VIEW_EVENT`, PUB†) | the harness calls `viewer.fitToView` and the call returns synchronously | O-1, O-2 |
| `RST` | `H-CALL` (base) | HAR + PUB† (return value / `VIEWER_STATE_RESTORED_EVENT`) | the harness calls `restoreState(home, undefined, true)` and it returns or throws | O-13 |
| `SST` | `H-CALL` (base) | HAR | a settle invocation is started | O-24 |
| `SMP` | `H-T4` (base) | HAR + PUB (`getCamera`) | the settle loop takes one T4 sample | O-21, O-22, O-24, O-26 |
| `CAM` | `P-FRM` | PUB (`getCamera`) + HAR (rAF clock) | the diagnostic takes a per-frame camera snapshot at its rAF sampling point, whether or not a settle is running | O-21, O-22. R §7 DH-1/DH-3 "one observation" |
| `TCK` | `P-TICK` | PUB | `VIEWER_RENDER_TICK` dispatched | O-18 |
| `CC` | `P-CC` | PUB† | `CAMERA_CHANGE_EVENT` dispatched | O-15 |
| `CC0` | `P-CC0` | PUB† **[INF, unverified]** | the zero-motion `cameraChanged` predicted at consumption (step 0 `syncCamera`) | O-15 refinement (A2). This is a sensitivity atom only |
| `TC` | `P-TC` | PUB | `CAMERA_TRANSITION_COMPLETED` dispatched to a never-removed harness listener | O-16. Supersedes the O-17 proxy |
| `AE` | `V-EDGE` | VB7124 (VB-3) | `TRANSITION_ACTIVE_FLAG_CHANGED` dispatched | O-8 |
| `XTC` | `X-TAG` | SYN | request-tagged completion (ideal oracle) | O-27, D2-spec §6.2 |
| `NV` | — | PUB | live only: bounded numeric sample immediately after its `SMP` (field `nv`) | R §7 DH-4 |
| `META` | — | HAR | first record of a **live** trace only (run metadata, §6.1.3). Never part of a projection | §6.5 |
| `END` | — | HAR | last record of a **live** trace only (§6.1.3) | §6.3, §6.4 |

#### 6.1.2 Fields

| Key | Meaning | Type / domain | Class | On kinds | Atom |
|---|---|---|---|---|---|
| `f` | frame index: the harness rAF counter (live) or the D2 synthetic frame (offline) | int 0..`maxFrames` | HAR | all | base |
| `k` | event kind | enum §6.1.1 | per kind | all | base |
| `r` | **request token** assigned by the harness at its own call site (1-based call order of `fitToView` within the run) | int ≥1 | **HAR only** | `FIT`, `SST` | `ID-ON` axis only (§8.4) |
| `s` | settle id (`G` = the gate settle of N−1, `S` = the subject settle) | enum | HAR | `SST`, `SMP` | base |
| `n` | 1-based sample index within the settle | int 1..64 | HAR | `SMP` | base |
| `d` | T4 per-sample decision: `none` (first sample or not within tolerance), `settled`, `timeout` | enum | HAR | `SMP` | base |
| `fr` | `1` on the subject's deciding sample, the same sample the frozen frustum predicate evaluates (O-26) | 1 | HAR | `SMP` | base |
| `cl` | tolerance class of the camera value: projection-local first-appearance index of its `cameraSamplesWithin(·,·,1e-9)` class (§8.5) | int ≥0 | PUB value + HAR classing | `SMP` (base); `CAM`, and post-call on `FIT`/`RST` (`P-FRM`) | base / `P-FRM` |
| `xc` | exact class of the camera value (bitwise equality of the 32-entry sample), projection-local index | int ≥0 | PUB value + HAR classing | wherever `cl` appears | `P-XS` |
| `rs` | restore result | `OK` / `NOOP` / `THROW` | PUB† return + HAR | `RST` | base |
| `pd` | pending-slot read (`getRequestTransition()`), taken synchronously **after** each harness call and at each `SMP`/`CAM`. `ID-ON`: `{p, b}`, where `p` ∈ {0,1} is presence and `b` is the HAR token bound to that slot object by the post-call read (§6.2 R2). `ID-OFF`: `{p, ch}`, where `ch`=1 iff the slot object differs from the previous visible read | object | VB7124 (VB-1) value; `b` is HAR | `FIT`, `RST`, `SMP`, `CAM` | `V-PEND` |
| `pq` | pre-call pending-slot read on `FIT` (R2), same encoding as `pd` minus `nw`. `pd` on `FIT` additionally carries `nw` ∈ {0,1} (post-call object differs from pre-call object). **Slot-read invariants:** `p=0` ⇒ no `b`; `p=1` ⇒ exactly one of `b` (ID-ON) or `ch` (ID-OFF); `nw` only on the `FIT` `pd`, where it is required; `pq` only together with `pd` | object | VB7124 (VB-1) | `FIT` | `V-PEND` |
| `ac` | transition-active read (`getTransitionActive()`) at the same read sites as `pd` | 0/1 | VB7124 (VB-2) | `FIT`, `RST`, `SMP`, `CAM` | `V-ACT` |
| `ev` | new flag value of an active edge | 0/1 | VB7124 (VB-3) | `AE` | `V-EDGE` |
| `ow` | ground-truth camera owner at the read: `INIT`, `RESTORE`, `T<k>`, `T<k>*` | enum | **SYN only** | `SMP`, `CAM` | `X-OWN` |
| `tg` | ground-truth request token of a completion | int | **SYN only** | `XTC` | `X-TAG` |
| `tm` | dispatch/read time relative to the `META` origin, in integer tenths of a millisecond (`performance.now()` deltas) | int ≥0 | HAR | all live kinds | live only (never in synthetic traces) |
| `dg` | live sample digest: the first 16 hex characters of the SHA-256 of the canonical 32-entry `[...matrixWorldInverse, ...projectionMatrix]` array | hex16 | PUB value + HAR | `SMP`, `CAM`, post-call | live only |
| `nv` | live bounded numeric sample: the 32 finite doubles as little-endian IEEE-754 binary64 bytes (256 B), base64-encoded (exactly 344 characters). It is carried **only** on a dedicated `NV` record that immediately follows its `SMP` (so the `SMP` stays within the ordinary event cap). A non-finite value is not encoded and the sample is digest-only (C7) | string(344) | PUB | `NV` (≤ retained-sample cap, §6.4) | live only |
| `q` | live sequence number, **stamped by the recorder** (never by the caller): `META.q0` for the first accepted data event, +1 per accepted event; rejected appends consume no number (whole-trace integrity, §6.1.3) | int 1..8,192 (the §6.4(b) data-event cap) | HAR | all live data kinds | live only |
| `rn` | optional run-id echo; if present it MUST equal `META.run` | string 1..32 | HAR | all live data kinds except `NV` (keeps the fixed-width `NV` bound) | live only |

**Per-kind required fields** (every projection keeps them; atom-dependent fields are checked against the configured atoms): `RST` `rs`; `SST` `s`; `SMP` `s`, `n`, `d`, `cl`; `CAM` `cl`; `AE` `ev`; `XTC` `tg`; `NV` `nv`; every event `f`, and every live data event `tm` and `q`. A throwing `RST` carries no post-call read. Kind and field names are looked up as own properties only (a kind or key such as `toString` is invalid).

Offline, the sequence number is **implicit**: it is the array position. A live trace MUST be appended strictly in dispatch order, and each live data event additionally carries the **explicit** recorder-stamped `q`, which MUST equal its data position + `META.q0` − 1 (checked by the whole-trace validator, §6.1.3; a gap, rollback or duplicate is a whole-trace failure). `tm` MUST be **non-decreasing** after quantization to tenths of a millisecond (equal values are allowed, and position breaks ties). Projections (§8.3) renumber implicitly by filtering.

#### 6.1.3 Live `META` and `END` records (live only; all fields required)

| Record | Field | Type | Meaning |
|---|---|---|---|
| `META` | `k` | `"META"` | kind |
| | `f`, `tm` | int `0`, int `0` | origin of the frame counter and the relative clock |
| | `sv` | int, exactly `1` | trace schema version (the only supported value; anything else ⇒ `SCHEMA-VERSION-UNSUPPORTED`) |
| | `run` | string 1..32 chars | run id (opaque, no timestamp); `END.run` and every data `rn` MUST equal it |
| | `hh`, `ph`, `sh` | hex64 each | SHA-256 of the harness, the procedure and this spec |
| | `vv` | string ≤ 16 chars (`"ABSENT"` when unreadable) | observed `LMV_VIEWER_VERSION`, recorded verbatim |
| | `vd` | hex64, or `"ABSENT"` | observed SHA-256 of the decoded `viewer3D.js` bundle actually loaded, recorded verbatim |
| | `vg` | 0/1 | VB-0 guard result. `vg = 1` is valid **only** if `vv === "7.124.2"` and `vd ===` the pinned digest (exact form below); otherwise the whole `META` is invalid |
| | `vb` | object `{VB-1..VB-3: 0/1}`, all three keys required | **structural** per-row presence results (only the rows this schema uses). MUST be all `0` when `vg = 0` or when (`vv`, `vd`) is not the pinned build |
| | `br` | string ≤ 24 chars | coarse browser family and major version |
| | `at` | duplicate-free array of searchable atom ids (§8.3; no SYN atom) | configured atoms. Per-atom **availability is derived, not declared**: an atom is available iff it is in `at` and, for a `V-*` atom, VB-0 holds and its `vb` row is `1` (and, for `V-EDGE`, `END.pc` VB-3 is `1`) |
| | `id` | `"ON"` / `"OFF"` | identity axis |
| | `cp` | object | the §6.4(b) caps in force: **exactly** the enforced cap set (same keys, same values) |
| | `ec` | `{min, max}`, ints, `0 ≤ min ≤ max ≤ 8,192` | expected data-event count bounds for this procedure |
| | `q0` | int, exactly `1` | first data sequence number |
| | `cs` | 0/1 | capture-start promise: `1` ⇒ the first data event is the capture-start `CAM` at `f = 0`, `tm = 0` (R3 INIT baseline) |
| `END` | `k` | `"END"` | kind |
| | `f`, `tm` | int | frame and time at close (≥ the last event) |
| | `run` | string | MUST equal `META.run` |
| | `ne`, `nb` | int | data events accepted, and data-event bytes accepted (Σ (canonical bytes + 1), the recorder's accounting) |
| | `lq` | int | terminal sequence: the last accepted `q` (`0` if none) |
| | `nvn`, `nvx` | int | numeric samples retained, and numeric samples not retained (C7) |
| | `rj` | int | appends rejected (cap or schema) |
| | `iv` | int, ≤ `rj` | appends rejected because the event failed schema validation (§6.3 C8) |
| | `pc` | object `{VB-3: 0/1}` | **behavioural** VB-3 positive-control result, obtained **after** the data capture (see "Capture order" below). Absent or not run ⇒ `{VB-3: 0}` |
| | `overflow`, `truncated` | 0/1 | §6.3 C5 / C4 |
| | `ts` | `OK` / `TRUNCATED` / `OVERFLOW` / `MALFORMED` | terminal status, exactly the one implied by the flags (precedence `TRUNCATED` > `OVERFLOW` > `MALFORMED` (`iv > 0`) > `OK`); `OK` only if `truncated = overflow = iv = 0` |
| | `sd` | hex64 | stream commitment: SHA-256 of the canonical bytes of the ordered array `[META, ...data events]` |

**Validation (live).** `META` and `END` each have exactly the fields above (no others), with the stated types. Without overflow every rejection was a schema rejection (`rj = iv`); with overflow at least one was a cap rejection (`rj > iv`). A data event is validated against §6.1.1/§6.1.2 (including per-kind required fields, the slot-read invariants and own-property lookups; §6.1.2) **before** any recorder state changes. An invalid event is rejected, counted in `rj` and `iv`, and never partially written. A `META` that fails validation means the run does not start.

**Capture order (live; remediation M-6, revised by R-M4).** `META` is the first, immutable record, so it holds only values known before capture: the structural checks. The behavioural VB-3 positive control mutates Viewer state (a harness-owned fit), so it MUST NOT run before or during the capture: a pre-capture fit would change the starting pose and the fit history (the historical C6 call was the first fit of its run, and DH-1/DH-2 and the `INIT`/`PRIOR_TERMINAL` axis depend on both). A future live diagnostic MUST therefore run, in this order:
1. **Structural checks (read-only):** VB-0 (`LMV_VIEWER_VERSION` and the loaded bundle digest, exact pinned form below) and the VB-1…VB-3 presence checks of R §6 (function/constant present, expected type).
2. **Quiescence check (read-only):** `getRequestTransition()` null, `getTransitionActive()` false and no edge for a fixed number of consecutive frames. If quiescence is not reached within a fixed frame budget, the run does not start (no trace; recorded only in the run manifest).
3. **Capture:** `META` (with `vg`, `vb`) at frame/clock origin `f = 0`, `tm = 0`; then the capture-start `CAM` read at `f = 0`, `tm = 0` (§6.2 R3 INIT baseline); then data events. Nothing the diagnostic itself does changes Viewer state before the procedure's own first call.
4. **Post-capture positive control (VB-3 only):** after the last data event, one harness-owned fit that must produce a true then a false `TRANSITION_ACTIVE_FLAG_CHANGED` edge within a fixed frame budget. Its events are not data events. Result → `END.pc`.
5. **`END`**, then analysis. The C6 guard is applied **post hoc**: `{vg, vb}` from `META` and `{pc}` from `END`. A failed or missing control disables `V-EDGE` (C6, `VB_UNAVAILABLE:VB-3`); the already-recorded `AE` events are then removed by projection before correlation (C6 composition rule, §6.3).

The frame budgets are left to the implementation plan (live is not authorized). An alternative that the plan MAY choose instead of step 4 is a positive control in a separate, disposable Viewer instance with the same pinned build; a same-session pre-capture control is not permitted. The control fit is a diagnostic-only action and is never part of the accepted G2 procedure. Whether a post-capture control is representative of in-capture VB-3 behaviour is a **live verification gate**: any live design MUST retain bounded evidence of the control itself (its edges and frame budget, within the §6.4(b) caps) and either define and check representativeness explicitly or use the disposable same-build instance; a gated control alone is not representative evidence.

**Byte accounting (live).** The capped "total trace bytes" (§6.4(b)) is the length of the canonical serialized array **including** brackets, commas, `META` and `END`. A fixed **reserve** of 2,048 B for `META` + `END` + delimiters is set aside before any data event is accepted, so `END` can always be written. A data event is accepted only if the bytes accepted so far, plus that event, plus its comma, plus the reserve stay within the cap. The data-event count cap excludes `META`/`END`. A trace without a well-formed `END` is `TRUNCATED` (C4).

**Whole-trace integrity (mechanically checked before correlation; `trace-integrity.mjs` `validateTrace`).** A live trace is the ordered array `[META, ...data, END]`. The validator is **total** (never throws; own-property lookups only; prototype keys are ordinary unknown keys) and runs **before** any correlation. **Any** failure makes the **whole** trace `UNDIAGNOSABLE` (reason `TRUNCATED` if `END` is missing or `truncated = 1`, `OVERFLOW` if `overflow = 1`, otherwise `MALFORMED`): no partial trace and no prefix is ever positive evidence. Invariants and their stable error codes:

| Invariant | Code |
|---|---|
| records is an array of plain objects with an own string kind; validator options well-formed | `TRACE-NOT-ARRAY`, `RECORD-NOT-OBJECT`, `BAD-OPTIONS` (`VALIDATION-EXCEPTION` if the validator itself fails) |
| exactly one `META`, and it is record 0 | `META-MISSING`, `META-DUPLICATE`, `DATA-BEFORE-META` |
| `META` passes `validateMeta` and its byte cap; `sv` is the supported version; `cp` is exactly the enforced caps | `META-INVALID`, `SCHEMA-VERSION-UNSUPPORTED`, `META-CAPS-MISMATCH`, `META-TOO-LARGE` |
| VB-0 consistency: `vg = 1` or any `vb` row `1` only on the exact pinned build | `META-VB0-INCONSISTENT` |
| exactly one `END`, and it is the last record | `END-MISSING`, `END-DUPLICATE`, `DATA-AFTER-END` |
| `END` passes `validateEnd` and its byte cap; `ts` is the status implied by the flags | `END-INVALID`, `TERMINAL-STATUS-INCONSISTENT`, `END-TOO-LARGE` |
| one run: `END.run` and every data `rn` equal `META.run` | `RUN-ID-MISMATCH` |
| no mid-stream mutation: a data record never carries a `META`/`END`-only field (`vv`, `vd`, `vg`, `sv`, `vb`, `at`, `cp`, `id`, …); no later record asserts a different `vv`/`vd`/`sv` | `META-FIELD-IN-DATA`, `VERSION-MIXED` |
| every data event passes the live schema (§6.1.1/§6.1.2, incl. `q`, `tm`) and its byte cap | `DATA-INVALID`, `EVENT-TOO-LARGE` |
| sequence: first `q = META.q0`, then +1 each | `SEQ-START`, `SEQ-GAP`, `SEQ-ROLLBACK`, `SEQ-DUPLICATE` |
| `META.cs = 1` ⇒ the first data event is the `CAM` at `f = 0`, `tm = 0` | `CAPTURE-START-MISSING` |
| `END.ne` = data count; count within `META.ec` and the data-event cap | `COUNT-MISMATCH`, `COUNT-OUT-OF-BOUNDS` |
| `END.nb` = Σ (canonical bytes + 1) of the data events; `END.lq` = last `q`; `END.f`/`END.tm` ≥ the last data event's | `BYTES-MISMATCH`, `LAST-SEQ-MISMATCH`, `END-BEFORE-LAST-EVENT` |
| `END.nvn` = number of `NV` records (≤ the retained-sample cap) | `NV-COUNT-MISMATCH` |
| `END.sd` = SHA-256(canonical `[META, ...data]`); whole trace within the total cap | `STREAM-DIGEST-MISMATCH`, `TRACE-TOO-LARGE` |
| terminal status: `truncated = 1` (C4), `overflow = 1` (C5, never valid positive evidence), `iv > 0` (C8) | `TRUNCATED`, `OVERFLOW`, `MALFORMED-APPENDS` |

**VB-0 exact accepted form (independent review H1).** The pins live in one place (`pins.mjs` `PINNED_VIEWER_VERSION`, `PINNED_VIEWER_BUNDLE_SHA256`). VB-0 holds **iff** `META.vv === "7.124.2"` (strict string equality; no trimming, case folding, `v` prefix stripping, numeric coercion or other normalization) **and** `META.vd === 12b9fe49f41dc99ccec62535e5c887da915980829da2e941cfe4da3d7197c02e` (the decoded `viewer3D.js` SHA-256 of R [SRC]) **and** `META.vg === 1`. Missing, `"ABSENT"`, `""`, other versions (`7.124.1`, `7.125.x`), padded or prefixed strings, non-string values and any other digest are mismatches. **Envelope binding:** VB-0 is evaluated once, from the single validated `META`, for the whole stream; a data record can never assert or override the version. Version-bound content (`AE`, `pd`, `pq`, `ac`) is usable **only** if the whole-trace check passes **and** VB-0 holds (`vbEligible`). If the envelope is valid but VB-0 fails (an honest `vg = 0`, all `vb = 0` record), the trace is usable **only** as public+harness: every `V-*` atom is disabled and its events/fields are removed (C6 composition rule, §6.3), with no fallback and never upgraded. A `META` that claims `vg = 1` (or any `vb` row `1`) on another build is not a valid envelope at all (whole trace `UNDIAGNOSABLE`). [SYN] All of this is a design-bound reference tested on synthetic records only; no live trace exists.

#### 6.1.4 Fields considered and excluded (research-justified omission)

| Candidate (prompt §6.1) | Decision | Reason |
|---|---|---|
| transition progress (O-10, VB-6) | **excluded** | Highest drift risk. Its value over `AE` + `cl`/`xc` is not demonstrated (R §4, §9). Its destination is closure-only |
| active-transition token | **not a Viewer field** | It is derived by the correlator (§6.2 R3) from `AE` + bound `pd`. It is never emitted as an observation |
| camera-write owner token | `ow`, **SYN only** | No Viewer field records the writer (O-12). Live ownership is *inferred* (§6.2 R5), never observed, unless invasive V-WRAP is separately authorized (excluded here) |
| competing flags (O-6, VB-4) | **excluded** | Relevant only to foreign transitions (DH-6a). D2 cannot evaluate them. A future diagnostic that targets DH-6a must justify adding them |
| pivot (O-4, VB-5) | **excluded** | Transient and weak, and not in the T4 sample |
| `getState` viewport (O-23) | **excluded** | `cl`/`xc`/`dg` from `getCamera` cover the T4-relevant pose. Adding fields would add model data without discrimination |
| invasive write wrappers (O-11, VB-7) | **excluded** | They mutate Viewer objects (R §9 "unsafe/unnecessary") |
| absolute timestamps, paths, URNs, property data | **excluded** | §6.5 privacy rules |

### 6.2 Correlation model

**Principle.** Correlation is built from **harness-tagged identity** (the token assigned at the harness call site) joined to **version-bound slot-object identity** by a synchronous read. Event order alone MUST NOT be the sole basis of an attribution when a token-bearing binding exists for that step. An attribution that rests only on order is labelled `ORDER_ONLY` and counts as `AMBIGUOUS` for any proof-like statement (§6.3).

Rules. Each rule states what it can conclude and how it fails:

- **R1. Request issuance (HAR).** Each harness `fitToView` call receives token `r` = call order. Its existence is a harness fact. It is **not** a request-creation witness, because `FIT_TO_VIEW_EVENT` fires even when no request is created (O-2).
- **R2. Pending-slot binding (VB-1 + HAR).** The harness reads `getRequestTransition()` synchronously **immediately before** the call (pre-call read `pq`) and **immediately after** it returns (post-call read `pd`), with no `await` between the reads and the call.
  - Post-call non-null **and** a different object from the pre-call read: the slot object is bound to `r` (`pd.b = r`, `pd.nw = 1`).
  - Post-call non-null **and the same object** as the pre-call read: `r` is `NO_REQUEST_OR_UNRESOLVED`. The slot keeps its previous binding and is **never** rebound to `r` (`pd.nw = 0`). This prevents a no-op fit from capturing an older pending request.
  - Post-call null: `r` is `NO_REQUEST` (DH-9 evidence for `r`).
  - Domain note: D2 has no no-op fits, so every synthetic fit yields `nw = 1`. The unchanged-object branch is therefore verified only by hand-built unit traces (§8.10), never by the synthetic experiment.
  - A later read whose slot object was never bound (written by no harness call) is `pd.b = "U"` (unbound). That is evidence of a foreign slot writer and makes slot ownership `AMBIGUOUS` from then on. **Coverage is partial:** a `"U"` read detects only a foreign object that is still in the slot at some visible read. A foreign object written after the last visible read and consumed in the next tick is never seen (R3).
  - Without VB-1: slot ownership is `UNAVAILABLE`.
- **R3. Consumption / transition ownership (VB-3 + R2).** A true `AE` edge marks a consumption. Without VB-3, consumption instants are `UNAVAILABLE`. Neither `CC` nor `CC0` nor `TCK` may substitute as proof. A true edge with the most recent read `p=0` and no foreign evidence is **contradictory** (§6.3 C3) in assumption mode only (see below).
  - **Unobservable slot window (remediation H-2).** In 7.124.2 the consumer clears the slot (`setRequestTransition(false)`, V:105009) before `transitionView` raises the active flag (V:107122), and no read-only atomic consumption witness exists. Between the most recent visible `pd` read and the edge, an unobserved writer can replace the slot object, and that object is then consumed without any read seeing it (no `"U"` binding ever appears). Which request was consumed is therefore **not observable** in 7.124.2. VB-1 and VB-3 cannot verify the absence of such a writer.
  - **Default (`slotWindow = OPEN`, fail-closed; the only mode a live 7.124.2 diagnostic may use without an owner-accepted assumption):** the consumed token is **never** inferred. The active transition is "token unknown (window)". Every output that depends on that token is `AMBIGUOUS` with reason `UNOBSERVED_SLOT_WINDOW`: a terminal or in-flight owner (`OWN`, `PRIOR_TERMINAL`, `IN_FLIGHT`), subject state `ACTIVE_PLUS` or `COMPLETE`, and any non-empty completion attribution. Outputs read directly at the decision instant stay available: `PENDING` (the subject's bound slot object is visible at `t_d`), and `INIT`/`RESTORE` (no transition active, from edges), subject to the INIT-baseline and unread-restore rules below.
  - **Assumption mode (`slotWindow = ASSUME_NO_UNOBSERVED_WRITER`):** the edge consumes the request bound to the **most recent preceding visible `pd` read** with `p=1`, under two checked preconditions (every harness call between that read and the edge has its own post-call read; no read in that interval carries a `"U"` binding; otherwise `AMBIGUOUS`) and one **unchecked assumption**: no unobserved writer between that read and the edge. Each definite label that relied on R3 carries `assumption: NO_UNOBSERVED_WRITER`; it is an inference conditional on the assumption, never an observation. The assumption holds in D2 by construction (no foreign writer). Its open-world soundness is a **verification gate** before any live use of this mode, and adopting it in a live diagnostic is an owner decision (§10).
  - **Other windows that no read covers** (found by a Codex advisor pass on this remediation; the same OPEN/assumption split applies):
    - **INIT baseline.** `INIT` means "no writer since capture start". It is definite under `OPEN` only if the trace's first event is a visible camera read (`CAM`) taken at capture start, that is at `f = 0` (and, live, `tm = 0`, matching `META`); a delayed first `CAM` anchors nothing (remediation R-M2); otherwise an unobserved writer between capture start and the first read cannot be excluded (`AMBIGUOUS`, reason `NO_CAPTURE_BASELINE`; assumption mode: `INIT` with the assumption). A live diagnostic MUST emit that capture-start `CAM` as its first data event. D2 projections start with a harness call, so `OPEN` never asserts `INIT` offline.
    - **Unread restore.** When a `RST` with `rs=OK` has no post-call camera read (no `P-FRM`), an unobserved writer between the restore and the next read cannot be excluded, whether or not the later value differs (it may have undone the restore pose). `OPEN`: such a `RESTORE` is never definite (`AMBIGUOUS`, reason `UNREAD_WRITER`); assumption mode: `RESTORE` with the assumption (remediation R-M3).
    - **True edge after an empty visible slot.** Under `OPEN` this is evidence of an unobserved slot writer (DH-6a): identity becomes `AMBIGUOUS` (`IDENTITY_AMBIGUOUS`). Only in assumption mode is it the C3 contradiction `TRUE_EDGE_EMPTY_SLOT`.
  - The assumption tag is `NO_UNOBSERVED_WRITER`: no writer acts in any of these windows. A camera write that leaves the 32-entry value unchanged is invisible in both modes (pre-existing R5 limitation).
  - The active-transition token (when one is inferred) equals the consumed token until the next false edge.
- **R4. Completion attribution (VB-3 + PUB).** A `TC` is attributed to the active-transition token iff it directly follows (next `TC`/`AE` position) a false `AE` edge with no intervening true edge. This adjacency is [SRC] (V:107116-107117). Without `V-EDGE`, `TC` attribution is `AMBIGUOUS` whenever more than one bound request is outstanding (DH-5).
- **R5. Camera-write ownership (inferred only).** The owner at a read is the latest **bracketing writer**:
  - a `RST` with `rs=OK` gives `RESTORE`;
  - an attributed `TC` of `k` gives `T<k>*`;
  - an active transition `k` together with a visible value change since its true edge (a `cl` change, or an `xc` change when `P-XS` is present) gives `T<k>` in flight.
  
  If an active transition shows no visible change since its true edge, the owner is "previous owner or an unobserved zero-change step" and is reported `AMBIGUOUS` unless the configuration provides positive evidence that no step ran. A visible value change with no bracketing writer is DH-6a evidence (`FOREIGN_CANDIDATE`) and makes ownership `AMBIGUOUS`. Inferred ownership is always reported as `INFERRED`, never `OBSERVED`.
- **R6. Restore interaction.** The restore's "outstanding" state is read from the `pd`/`ac` reads on the `RST` record itself (post-call). Whether the restored pose survives to `t_d` comes from `cl`/`xc` continuity on subsequent `CAM`/`SMP` reads, combined with R5. A `true` return is **never** a cancellation or effectiveness witness (O-13).
- **R7. T4 samples (HAR).** Each `SMP` is bound to its settle `s` and, under `ID-ON`, to the token of the fit that settle follows (`SST.r`). The deciding sample is the `SMP` with `d=settled` (or `timeout`). `t_d` is that record's position and frame.
- **R8. C8 / frustum observation (HAR).** The frustum observation is bound to the deciding sample itself (`fr=1`, O-26). It has no separate timing. A *post-quiescence re-measure* (DH-8) is a distinct future observation and is outside this schema's `fr` semantics.

**Normative correlator procedure** (deterministic; one forward pass over the projected trace):

```
state: binding = {}            # slot-object handle -> token | "U"   (handles come from pd.b under ID-ON; none under ID-OFF)
       slotTok = NONE          # token bound to the current slot object, or NONE / "U"
       activeTok = NONE, lastWriter = INIT, changedSinceEdge = false, reasons = []
       completions = []        # attributed tokens, or "?" when unattributable
validate first: cfg (atoms, ID axis, slotWindow, mode) and every event against §6.1 and the configured atoms/ID axis (§6.3 C8); on failure or on any exception:
  return all questions UNDIAGNOSABLE(MALFORMED). The procedure never throws.
for each event e in order:
  check C3 contradictions first (§6.3); on any: return all questions UNDIAGNOSABLE(CONTRADICTION:<rule>)
  FIT:  if V-PEND visible: apply R2 (pq/pd/nw) -> slotTok updated or unchanged; else slotTok = UNKNOWN
  RST:  if rs=OK: lastWriter = RESTORE; changedSinceEdge = false
  AE ev=1: if V-PEND visible and slotTok is a token (not NONE/UNKNOWN/"U"):
             activeTok = (slotWindow == OPEN) ? WINDOW : slotTok      # R3; WINDOW = consumed, token not inferable
           else activeTok = UNKNOWN;
           slotTok = NONE; changedSinceEdge = false
  AE ev=0: pendingFalseEdge = activeTok
           if P-TC is NOT visible: activeTok = NONE; hiddenTerminal = true     # the terminal write is unobservable; never credited as in-flight
  TC:   if V-EDGE visible and the previous AE was ev=0: completions += pendingFalseEdge; lastWriter = TERMINAL(pendingFalseEdge)
        else: completions += "?"; lastWriter = TERMINAL("?")
        activeTok = NONE
  SMP/CAM: if value class (xc if P-XS visible else cl) differs from the previous visible read and activeTok != NONE:
             lastWriter = INFLIGHT(activeTok); changedSinceEdge = true
           if V-PEND visible: refresh slotTok from pd (b under ID-ON; under ID-OFF a p=1 with ch=1 sets slotTok = UNKNOWN)
  on the deciding SMP (fr=1): snapshot the state as S_d
outputs (precedence: CONTRADICTION > UNAVAILABLE > AMBIGUOUS > definite):
  Q-OWNER: UNAVAILABLE if neither V-EDGE nor P-TC is visible;
           AMBIGUOUS(OBSERVABLE_ABSENT:P-TC) if S_d.hiddenTerminal (after the V-EDGE/fitSeen check);
           AMBIGUOUS if S_d.lastWriter contains UNKNOWN or "?";
           AMBIGUOUS(UNOBSERVED_SLOT_WINDOW) if S_d.lastWriter is TERMINAL(WINDOW) or INFLIGHT(WINDOW);
           AMBIGUOUS if (S_d.activeTok != NONE and not S_d.changedSinceEdge);
           under OPEN: AMBIGUOUS(NO_CAPTURE_BASELINE) for INIT unless the first event is a CAM read, and
             AMBIGUOUS(UNREAD_WRITER) for any RESTORE without its own post-call read (assumption mode: both carry the assumption);
           else map lastWriter: RESTORE->RESTORE, INIT->INIT, TERMINAL(subject)->OWN, TERMINAL(other)->PRIOR_TERMINAL, INFLIGHT(*)->IN_FLIGHT
             (the last three carry assumption NO_UNOBSERVED_WRITER)
  Q-SUBJ:  UNAVAILABLE unless V-PEND and V-EDGE are visible and ID-ON;
           PENDING if S_d.slotTok == subject; AMBIGUOUS(OBSERVABLE_ABSENT:P-TC) if S_d.hiddenTerminal; ACTIVE_PLUS if S_d.activeTok == subject and S_d.changedSinceEdge;
           AMBIGUOUS if S_d.activeTok == subject and not S_d.changedSinceEdge (ACTIVE0 vs an unobserved zero-change step, R5);
           COMPLETE if subject is in completions before S_d;                (ACTIVE_PLUS/COMPLETE carry the assumption)
           AMBIGUOUS(UNOBSERVED_SLOT_WINDOW) if S_d.activeTok == WINDOW or WINDOW is in S_d.completions; else AMBIGUOUS
  Q-ATTR:  AMBIGUOUS if any "?" is in completions; AMBIGUOUS(UNOBSERVED_SLOT_WINDOW) if WINDOW is in completions;
           else the token list ("-" if empty; a non-empty list carries the assumption)
```
`subject` is the token of the subject settle's `SST.r`. It is known only under `ID-ON`; under `ID-OFF`, `Q-OWNER`'s OWN/PRIOR split and `Q-SUBJ` are `UNAVAILABLE`. Each `AMBIGUOUS`/`UNAVAILABLE` output carries one reason code: the first applicable condition in the order listed.

**Soundness requirement (offline, mandatory).** The prototype's correlator implementing R1–R8 MUST NOT output a definite label that differs from D2 ground truth, for any relevant schedule under any configuration and slot-window mode it is run on. A single wrong definite label means exit 2. Completeness (the fraction of definite labels) is reported, not required. Offline soundness of the assumption mode is soundness **within D2** only, where the assumption is true by construction; the `slotWindow = OPEN` result is the one that does not depend on it.

### 6.3 Fail-closed semantics

Verdict vocabulary, used per question and per trace:
- `DIAGNOSED`: exactly one label is consistent with the trace under the stated observation model. Offline this means "unique within D2's closed universe". It is **never** "proven" and never a historical-causality claim.
- `AMBIGUOUS`: more than one label is consistent, or an attribution is `ORDER_ONLY`.
- `UNDIAGNOSABLE`: the trace is not usable for that question, or for any question when the cause is trace-level.

No case below may produce `DIAGNOSED`, `PASS`, `PROVEN`, or any acceptance-like verdict.

| # | Case | Detection | Verdict | Scope |
|---|---|---|---|---|
| C1 | **Required observable absent** (atom not captured, listener never registered, read site skipped), **or no sound procedure** | the question's **sound-correlator requirement** (table below) is not met by the captured atoms. §8.6 minimal sets are closed-world fingerprint results and are **never** used for this check (remediation H-1) | `UNDIAGNOSABLE` (reason `OBSERVABLE_ABSENT:<atom>`, or `NO_SOUND_PROCEDURE`). Offline outputs count it as `unavailable` (§7.4) | that question |
| C2 | **Ambiguous request identity** | `pd.b = "U"`; consumption with more than one candidate binding; R3/R4 preconditions unmet; or an `ORDER_ONLY` attribution | `AMBIGUOUS` (reason `IDENTITY_AMBIGUOUS`) | questions depending on that attribution |
| C3 | **Contradictory ordering** | non-monotone `tm` or `f`; a false `AE` without a preceding true edge; two consecutive edges with the same value; a true edge with an empty bound slot and no foreign evidence (assumption mode only; under `OPEN` it is DH-6a evidence, §6.2 R3); a `TC` with no active transition while `V-EDGE` is captured; `d=settled` on a settle's first sample; an `SMP` after its settle decided | `UNDIAGNOSABLE` (reason `CONTRADICTION:<rule>`) | **whole trace** |
| C4 | **Trace truncation** (capture ended before the `END` record, or before the subject's own false edge or quiescence when the question needs post-decision events) | `END` missing, or `END.truncated = 1` | `UNDIAGNOSABLE` (reason `TRUNCATED`). No partial verdict is taken from the prefix | whole trace |
| C5 | **Buffer overflow** | an append that would exceed any §6.4 cap | the append is **rejected**, never partially written. `END.overflow = 1` and `UNDIAGNOSABLE` (reason `OVERFLOW:<cap>`) | whole trace |
| C6 | **Version-bound path unavailable** | the guard **fails closed**: a `V-*` atom is enabled only if VB-0 holds — **derived**, not trusted: `META.vv === "7.124.2"` and `META.vd ===` the pinned bundle digest exactly (§6.1.3 exact form), **and** `META.vg === 1` — and `META.vb[row] === 1` (own property, exact value) and, for VB-3, the post-capture control `END.pc["VB-3"] === 1` (applied post hoc). Absent, partial or malformed metadata disables the atom. `vg ≠ 1` disables every VB atom. **Composition (R-L3):** events and fields of a disabled atom are removed by projection before correlation, so the verdict is the C6 one, never C8 `MALFORMED` | affected questions are `AMBIGUOUS` (reason `VB_UNAVAILABLE:<VB-n>`). The run is reported as public+harness-tagged only. Event order is never substituted | per question |
| C7 | **Retained-sample cap reached** (§6.4) | numeric-sample counter equals the cap | later samples are retained as `cl`/`xc`/`dg` only. Questions needing numeric values for those samples are `AMBIGUOUS` (reason `NUMERIC_NOT_RETAINED`) | per question |
| C8 | **Malformed trace** | an event fails §6.1 validation (unknown or prototype-chain kind/field, missing per-kind field, slot-read invariant violated), a field or kind that the configured atoms or ID axis cannot produce, or live `END.iv > 0` | `UNDIAGNOSABLE` (reason `MALFORMED`). The correlator never throws | whole trace |

**Live entry point (implementation-plan requirement, R-L2; reference: `trace-integrity.mjs` `correlateTrace`).** The reference correlator never sees `META`/`END`. A live plan MUST provide a `META`/`END`-aware entry point that, in this order: (1) runs the whole-trace validator (§6.1.3) and maps **any** failure — including `END` absent or `END.truncated = 1` (C4), `END.overflow = 1` (C5), `END.iv > 0` (C8) and every envelope invariant — to whole-trace `UNDIAGNOSABLE` **before** any correlation; (2) derives the configuration from `META.at`/`META.id`; (3) applies the post-hoc C6 guard (`META.vg`/`vv`/`vd`/`vb`, `END.pc`), with VB-0 derived from the exact pinned (`vv`, `vd`); (4) removes the events/fields of each disabled configured `V-*` atom (an atom not in `META.at` is never silently dropped: its events are C8 `MALFORMED`); (5) correlates in live mode. A dropped event can remove the very read or edge that keeps a label ambiguous, so no label may be taken from such a trace.

**C1 requirements of the sound correlator** (coverage depends on mode: the §8.6 minimum answers 2 of 13 questions under `OPEN`, where `Q-ATTR` has 0 definite labels in every configuration, and 3 of 13 under the assumption mode; only 3 of 13 questions have a sound procedure in this package):

| Question | Required for any definite label (for `Q-OWNER`: once a fit was issued before the decision; every G2 settle follows a fit) | Additionally required for … | Never definite |
|---|---|---|---|
| `Q-OWNER` | `V-EDGE` (positive evidence that no transition is active, once a fit was issued) | `ID-ON` for `OWN` vs `PRIOR_TERMINAL`; `V-PEND` + `ID-ON` + the R3 assumption for `OWN`/`PRIOR_TERMINAL`/`IN_FLIGHT`; a capture-start `CAM` at `f = 0` (or the assumption) for `INIT`; `P-FRM`, i.e. the restore's own post-call read (or the assumption), for `RESTORE` | under `slotWindow = OPEN`: `OWN`, `PRIOR_TERMINAL`, `IN_FLIGHT`. `FOREIGN` is never asserted |
| `Q-SUBJ` | `V-PEND`, `V-EDGE`, `ID-ON` | the R3 assumption for `ACTIVE_PLUS`/`COMPLETE` | `ACTIVE0` (R5); under `OPEN`: `ACTIVE_PLUS`, `COMPLETE` |
| `Q-ATTR` | `P-TC` | `V-EDGE`, `V-PEND`, `ID-ON` and the R3 assumption for any non-empty list | under `OPEN`: any non-empty list |
| the other 10 (`Q-STALE`, `Q-ACTIVE`, `Q-RESTORE`, `Q-DH1`, `Q-DH2`, `Q-DH3A`, `Q-DH3B`, `Q-DH4`, `Q-DH7A`, `Q-TUPLE`) | — | — | no sound procedure is specified; a live diagnostic reports them `UNDIAGNOSABLE(NO_SOUND_PROCEDURE)`. Their §8 separability is a closed-world fingerprint result only |

Partial presence (some VB atoms captured, others not) is reported per question and never aggregated into an overall pass.

### 6.4 Hard numeric bounds

All caps are inclusive. A value **equal** to the cap is accepted. The first operation that would make the value **cap + 1** is rejected as stated. Nothing is silently truncated.

**(a) Offline prototype (this package):**

| Item | Cap | At exactly the cap | At cap + 1 |
|---|---|---|---|
| events per ground-truth trace (before projection) | **1,024** | accepted | append rejected → trace `UNDIAGNOSABLE(OVERFLOW:events)` → **process exit 2** (caps are sized for the D2 domain, so hitting one is a conformance failure) |
| bytes per event (canonical JSON) | **160** | accepted | event rejected → same as above, exit 2 |
| bytes per trace (canonical JSON array) | **163,840** (= 1,024 × 160) | accepted | exit 2 |
| retained numeric camera samples | **0** (offline outputs carry `cl`/`xc` only; numeric poses are never written) | — | any numeric pose in an output → exit 2 |
| retained full witness traces (`diag-witnesses.json` `traces`) | **16** | accepted | not retained; `tracesOmitted` incremented (selection is deterministic, §8.8). This is not a verdict change |
| collision-witness index entries | **468** (= 4 cells × 9 named configs × 13 questions, at most one pair each) | accepted | structurally impossible. If it occurs, exit 2 |
| minimal sets per (ID axis, cell, question) | **126** (= C(9,4), the Sperner bound for 9 atoms, so it cannot be exceeded by an antichain) | accepted | structurally impossible. If it occurs, exit 2 |
| `diag-summary.json` | **1,048,576 B** | accepted | exit 2 (abort before write) |
| `diag-witnesses.json` | **3,145,728 B** | accepted | exit 2 |
| total output directory | **4,194,304 B** | accepted | exit 2 |

**(b) Future live diagnostic (design bound only; not authorized):**

| Item | Cap | At cap + 1 |
|---|---|---|
| data events per run | **8,192** (excluding `META`/`END`; each `NV` counts as one event) | append rejected; `END.overflow=1`; trace `UNDIAGNOSABLE` |
| bytes per event (non-`NV`) | **256** | event rejected; overflow as above |
| bytes per `NV` record | **406** (344-char `nv` + keys; fixed-width encoding: 397 B worst case at `f = 99,999,999`, `tm = 2^53 − 1`, plus 9 B for the integrity sequence `"q":8192,`; `rn` is not allowed on `NV`) | event rejected; overflow as above |
| `META` / `END` record bytes | **1,536** / **384** (2 + 1,536 + 1 + 384 ≤ the 2,048 B reserve; every valid `META` is below its cap; worst-case `END` with all counters at 2^53 − 1 and the integrity fields `run`/`lq`/`ts`/`sd` is 371 B) | the run does not start (`META`) / impossible by reserve (`END`) |
| total trace bytes (§6.1.3 accounting) | **2,457,600** | overflow as above |
| retained numeric samples (`NV`) | **512** | sample kept as `cl`/`xc`/`dg` only; C7 |
| retained witness excerpts derived from a live trace | **32** | not retained; counted |
| settle samples per settle | **64** (mirrors D2's synthetic stand-in; the live deadline stays the frozen 5,000 ms) | not applicable. T4 itself is unchanged and this schema only records it |

### 6.5 Privacy and evidence integrity

**Offline outputs (this package):** no absolute paths, no wall-clock timestamps, no hostnames, no runtime or Node version strings (the D2 convention). Every object carries `synthetic: true`. Outputs are canonical JSON with recorded SHA-256 digests (§7.4). No live evidence is created.

**Future live outputs (design only; nothing created now):**
1. **Minimal content.** The trace holds only the §6.1 fields. Relative times are `tm` deltas only. Camera data is `cl`/`xc`/`dg`, plus `nv` within the cap. Model identity is the SHA-256 of the URN, never the URN itself. Target dbIds appear only where the procedure already names them. There are no property values, file paths, user names or absolute timestamps.
2. **Immutable capture.** The trace is written once to a new, write-once run directory and is never edited. Corrections become new files that reference the old digest.
3. **Hashes.** A per-file SHA-256 and a `MANIFEST` with digests of all files, the `META` record, and the digests of the harness, procedure and this spec.
4. **Provenance and runtime metadata (`META`).** Run id, harness SHA, procedure SHA, this spec's SHA, observed `LMV_VIEWER_VERSION` and loaded bundle digest, the VB-0 guard result, per-VB presence results, coarse browser family/major version, configured atoms, ID axis, and caps.
5. **No post-hoc mutation.** Any analysis reads the trace and writes separate outputs.
6. **Evidence status.** A live diagnostic trace would be **new** evidence. It is never retroactive proof about R1 (O-29), and producing it requires its own owner authorization (prompt §3).

---

## 7. Offline prototype

### 7.1 Location, isolation and inputs

- Directory: `docs/research/2026-10-05-g2-diagnostic-instrumentation/` (alongside the A1/A2 notes). All code is research-local, pure ESM, Node ≥ 20, no dependencies. It uses no network, Viewer, browser, `Math.random`, wall-clock reads in results, or `Math.sin/cos`.
- **D2 is imported read-only.** The prototype MAY import `schedules.mjs` (`enumerateSchedules`, `cellOf`), `machine.mjs` (`runSchedule`, `classify`, `mechanismLabels`, `STALE_CLASSES`), `contract.mjs` (`phi`, `cameraSamplesWithin`, `ORD_NAMES`, `parseFixtures`) and `canonical.mjs` (`canonicalStringify`, `canonicalBytes`, `sha256Hex`) from `docs/research/2026-10-04-g2-d2-synthetic-transition/`, and read its `fixtures.json` and `results/d2-summary.json`. It MUST NOT write anything into the D2 directory. It MUST NOT use `runSchedule`'s `opts.mutate` (a test-only fault hook) for experiment data.
- **D=30 stays outside inference.** The prototype MUST NOT call `characterizationSchedules` or simulate any `D=30` schedule. Only the 52,308 exhaustive schedules enter the experiment.
- **Input pins.** Validated before any enumeration. A mismatch means exit 2 with nothing written.

| Input | SHA-256 (expected) |
|---|---|
| D2 spec `2026-10-04-g2-d2-synthetic-transition-spec.md` | `635d183415270eb842b47522e21a704bf3cdf5a9b7d0685d6e104f427499c574` |
| D2 `fixtures.json` | `6ee6e9fa94266fcdd26875f60b280f16dc4343909baa03795180997a41f978e0` |
| D2 `machine.mjs` | `a78b096d795e058f6adcd02dc0e5c9f707627127c156755d8e639c35b98918bf` |
| D2 `schedules.mjs` | `4b41fac2bec83ac8797c48749fe1cde3bc7f069d5fe5d37c756d2e52e9a85d4d` |
| D2 `contract.mjs` | `71fa49cd85c3680ef560f8778896457444d2f36c90e317bdf7900b0dd7eea626` |
| D2 `canonical.mjs` | `73bbeadcaf0248b9a6f5bb16c4c7c690b3158fa094f192be4dd6c106aeaa038b` |
| D2 `results/d2-summary.json` (file bytes) | `fde4a12a443ad361d8d5f4be59b7b851689fd12f8cf9c2cf57399dd9029f17e2`. Its `outputDigestSha256` field MUST equal `e1d1b815ed351e6feba3e34822ba9895e54035158e685bfbe7f628f6d10bbb06` |
| this spec | recorded as `observed` only (not self-pinned, following D2 convention) |

- The output directory MUST be empty. It MUST NOT be under the D2 directory, `docs/research/evidence/`, or `test/acceptance/results/`. Committed reference output, if retained, goes in `docs/research/2026-10-05-g2-diagnostic-instrumentation/results/`.

### 7.2 Ground-truth extraction (observer replica + mandatory conformance)

`runSchedule` exposes only aggregate results and an elided trace. The prototype therefore MUST obtain per-phase ground truth from a research-local **observer replica**. The replica re-executes D2-spec §5.2 semantics exactly as `machine.mjs` implements them (frame micro-order; external/`H+` ops; phases in `ORD`; `T` = consume `C` then dispatch `R`; oracle deliveries; shadow run to D2's quiescence or frame 127) and emits ground-truth events (§7.3).

**Conformance gate (mandatory, every one of the 52,308 schedules).** The prototype calls D2 `runSchedule(sch, fixtures)` (no `trace`, no `mutate`) and compares these fields with the replica's: `cls`, `labels`, `inv`, `oracle`, `t4Frame`, `t4Samples`, `shadowEnd`, `terminalTokens`, `tokenLog`, `finalOwner`. It also checks the aggregate equalities: per-cell `classCounts` and `mechanismCounts` equal `d2-summary.json`, and the enumeration count equals 52,308 with cells 4,104 / 4,788 / 18,144 / 25,272. Any mismatch means exit 2. The summary records `d2Conformance{schedules, mismatches:0, fieldsChecked[], rowsChecked}`.

**Aggregate equality alone is insufficient.** The labels in §8.2 depend on decision-time state that the aggregate fields do not expose. The gate therefore also runs D2 `runSchedule(sch, fixtures, {trace: true})`, using the documented bounded-trace option (not `mutate`), on every schedule, and uses D2's **own** trace rows as the trusted surface. Each row is `[f, ph, ev, pendingToken, activeToken, progress, cameraOwner, transitionActive, smp, out]` (`machine.mjs` row writer; elided intermediate steps are documented in the D2 README).

The replica MUST reproduce the following, exactly and schedule by schedule:
- **(a)** Every D2 row, matched by `(f, ph, ev)`, with identical `pendingToken`, `activeToken`, `progress`, `cameraOwner` and `transitionActive` at that point. The replica's internal row stream MUST contain the D2 rows as an ordered subsequence.
- **(b)** The subject's deciding-sample row (`ph='H'`, `ev` = `ss<n>` (the subject-role settle in every family, including F0), `smp ∈ {settled, timeout}`). From that row the replica's `subj` (`pendingToken = subject` → `PENDING`; `activeToken = subject ∧ progress = 0` → `ACTIVE0`; `activeToken = subject ∧ progress ≥ 1` → `ACTIVE_PLUS`; otherwise `COMPLETE`) and `active` labels MUST be derived and equal.
- **(c)** The `restoreOK`/`restoreNOOP` row. A restore changes neither the slot nor the flag, so `pendingToken ≠ 0 ∨ transitionActive = 1` on that row is the pre-restore "outstanding" state, which MUST equal the replica's `restore` label.
- **(d)** Every `consN` / `skip` / `final` row, matched against the replica's `AE` / skip / `TC` emission frames.

D2's row writer applies only the per-row byte check and no row-count limit, so enabling `trace` on all schedules is within D2's own semantics. If any D2 row cannot be matched, exit 2.

### 7.3 Ground-truth event emission (normative mapping from D2 phases)

The window is frame 0 through D2 `shadowEnd`, inclusive. Within a frame:

1. **External / `H+` ops**, in D2 op order:
   - `fit k` emits `FIT{f, r:k}`, carrying the pre-call slot read `pq` and the post-call reads `cl`, `xc` (camera), `pd` (slot, with `nw`), `ac` (active), and `ow`.
   - `restore` emits `RST{f, rs}`. When `rs≠THROW` it carries the same post-call reads.
   - settle activation emits `SST{f, s, r:k}`.
2. **Phases in `ORD`:**
   - `H`: first `CAM{f, cl, xc, pd, ac, ow}`. Then, for each running settle in start order with `f ≥ firstFrame`, `SMP{f, s, n, d, cl, xc, pd, ac, ow}`, with `fr:1` on the subject's deciding sample.
   - `A`: on the final step only, emit `AE{f, ev:0}`, then `TC{f}`, then `XTC{f, tg:k}`. Non-final steps emit nothing.
   - `T`: on consumption, emit `AE{f, ev:1}` then `CC0{f}`. On a D2 `skip`, emit nothing for the tick. Then, if D2's dispatch sub-step `R` performs an autocam sync, emit `CC{f}`. Finally emit `TCK{f}`, unless this `T` was a `skip` (O-18: a skipped tick emits nothing).
   - Mapping note [INF]: D2 runs `R` even on `skip` frames. The replica follows D2 literally (it may emit `CC` on a skip frame). This modelling mapping is recorded in `interpretationLimits`.
3. Oracle deliveries emit nothing further (`XTC` is emitted at the terminal step).

`THROW`, `HARNESS_ABORT`, `PRECONDITION_BLOCKED` and `TIMED_OUT` schedules are emitted (for cap checking) but are **not relevant** (§8.2).

### 7.4 Output files and schema names

Two files, canonical JSON (D2 conventions), with digests computed as in D2 (`outputDigestSha256` = SHA-256 of the canonical summary with that field omitted; `companionDigestSha256` = SHA-256 of the canonical witnesses file):

1. **`diag-summary.json`**: `kind: "g2-diagnostic-sufficiency-summary"`, **`schemaVersion: 3`** (v3 adds the bounded `ablation` carrier below; v2 summaries lack it and are not conformant), `synthetic: true`. Keys:
   `inputHashes{<input>:{expected, observed}}`, `d2Conformance{schedules, mismatches, fieldsChecked[]}`, `atoms[{id, class, observables[], vbDeps[], inf:bool, base:bool}]`, `questions[{id, labelDomain[], definition}]`, `relevantCounts{cell:{total, relevant, excluded{class:count}}}`, `labelCounts{cell:{question:{label:count}}}`, `namedConfigs[{id, atoms[], idAxis}]`, `sufficiency{cell:{configId:{question:{relevant, distinguishable, ambiguous, blocks, ambiguousBlocks}}}}`, `minimalSets{idAxis:{cell:{question:{status, minimalSets[[atomId]], recommended[atomId]|null, recommendedIncludingInf[atomId]|null, subsetsEvaluated, monotonicityViolations}}}}`, `necessity{cell:{question:{requestIdentity, transitionActive, pendingSlot, formalCompletionPublic, cameraWriteOwnership, requestTaggedCompletion}}}`, `correlator{runKey:{cell:{question:{definite, definiteAssuming, ambiguous, unavailable, wrong:0, reasons{reasonCode:count}}}}}` (run keys §8.9; `definiteAssuming` counts definite labels that carry the R3 assumption; `reasons` is a bounded enum and its counts sum to `ambiguous + unavailable`), `ablation{…}` (the bounded exhaustive-ablation carrier, defined under **`ablation` carrier (normative)** below), `witnessIndex[{witnessId, cell, configId, question, scheduleA, scheduleB, labelA, labelB, projectionDigest, traceRefs[]}]`, `caps{observed, limit}`, `interpretationLimits[]`, `provenance{d2Dir, prototypeFiles[]}` (repo-relative only), `companionDigestSha256`, `outputDigestSha256`.
   Counts are integers. Fractions are written as the pair `{distinguishable, relevant}`, never as floats.
   **Encodings (normative):**
   - **Labels** are strings. Boolean questions use `"T"`/`"F"`. `Q-ACTIVE` uses `"0"`/`"1"`. `Q-TUPLE` is `"<owner>|<subj>|<active>|<restore>"`. `Q-ATTR` is the comma-joined token list (for example `"1,2"`), or `"-"` if it is empty.
   - `blocks` is the number of distinct projected traces among relevant schedules in the cell. `ambiguousBlocks` is the number of those blocks that contain more than one label. `ambiguous` is the number of schedules in ambiguous blocks.
   - **Ordering:** object keys are sorted canonically. Arrays are ordered: `atoms` and `namedConfigs` in the canonical order of §8.3, `questions` in §8.2 order, `minimalSets` per §8.6 step 3 and 4 order, `witnessIndex` by `(cell, configId order, question order)`, and `traces` by selection order (§8.8).
   - **Bounded collections:** `witnessIndex` ≤ 468 entries and `traces` ≤ 16 (§6.4). No per-schedule rows and no raw per-schedule traces are written (the retained traces are the ≤ 16 `traces` of the witnesses file). Per-subset information is retained **only** in the fixed-size `ablation` carrier below (one satisfying bit and one outcome-table index per configuration mask, plus aggregates). Elsewhere only minimal sets, the named-configuration tables and `monotonicityViolations` counts appear.
   - `caps` = `{observed:{<cap>:int}, limit:{<cap>:int}}` with identical key sets.
   - `synthetic: true` appears on the top-level object of each file and on every `witnessIndex` entry and `traces` entry. Other nested objects inherit it.

   **`ablation` carrier (normative).** Top-level key `ablation` is an object produced by the exhaustive sound-correlator ablation of §8.6. It records the outcome of all 2,048 configurations (1,024 element masks × 2 slot windows) in a **fixed-size, cardinality-bounded** form. Nothing in it grows with the number of schedules (40,788) or events; every schedule-dependent quantity is an integer count. It is the only place a per-configuration (per-subset) table is retained.
   - **Elements and masks.** `elements[10]` is the fixed element order (the 9 searchable atoms in canonical order, then `ID-ON`); a configuration mask `cm` ∈ [0, 1023] has bit `i` set iff `elements[i]` is present. `configMasks` = 1024. `windows[2]` = `["OPEN","ASSUME_NO_UNOBSERVED_WRITER"]` (window keys `OPEN` and `ASSUME` below). `configurationsEvaluated` = 2048, `schedulesPerConfiguration` = 40,788 (the relevant schedules), `correlatorEvaluations` = their product, 83,533,824. `exhaustive` is `true`. `objective` is the §8.6 step-3 text.
   - **Per-subset tables (the only per-subset retention).**
     - `satisfyingBitmapHex`: string of exactly **256** lowercase hex characters (1,024 bits). Hex digit `k` holds masks `4k..4k+3`; bit `(cm & 3)` of that digit is set iff configuration `cm` satisfies the §8.6 objective (both windows). It is a bitmap, never a numeric list.
     - `outcomes[]`: the table of **distinct** per-(window, mask) correlator outcomes, each `{<question>:{definite, definiteAssuming, ambiguous, unavailable, wrong, reasons{code:count}, nonDefiniteBySubjectTruth{<truth>:count}}}` for the three correlator questions `Q-OWNER`, `Q-SUBJ`, `Q-ATTR` (integers only), in order of first appearance (window-major `OPEN` then `ASSUME`, `cm` ascending). Cardinality ≤ 2,048 by construction (one entry per configuration at most); the reference run has 46.
     - `outcomeIndex{OPEN:int[1024], ASSUME:int[1024]}`: for each window, entry `cm` is the index into `outcomes[]` of that configuration's outcome. Each index is in [0, `outcomes.length` − 1].
   - **Aggregates (fixed key sets).** `target` (the full 9-atom + `ID-ON` configuration: `{mask, elements[], definite{window:{question:int}}}`); `lattice{status, satisfyingCount, subsetsEvaluated (= 1024), monotonicityViolations, minimal[], minimumCardinality, minimum[], unique, singleRemovalIrreducible[]}`; `canonical` (the §8.6 canonical minimum or `null`: `{mask, elements[], tieBreak, definite, necessity[]}` with one `necessity` entry per element of the set); `canonicalIncludingInf`; `coMinimal[]`; `windowOnly{OPEN,ASSUME}` (single-window objectives: `{satisfyingCount, monotonicityViolations, minimumCardinality, minimum[], unique, canonical, coMinimal[], irreducibleNotMinimum[]}`); `oldBundle` (the six-element comparison bundle with `singleRemoval[]`, one entry per element); `allConfigurations`, `publicOnly`, `idOff` (families: `{configMasksEvaluated, configurationsEvaluated, maxDefinite, achievedByCount, smallestAchiever}`); `influence{<element>:{<window>:{configPairs: 512, anyVerdict, definiteVerdict}}}` (10 elements × 2 windows; each part is `{configPairsChanged, scheduleChanges, atCanonical, aboveCanonical, firstWitness}` where `firstWitness` is `null` or `{schedule, elementsWithout[]}` naming one D2 schedule id, never a trace); `questionCoverage{definition, noSoundProcedure[], canonical, full}`; `unsoundConfigurations[]`. Each set is `{mask, elements[]}`; each `minimal[]`/`minimum[]`/`coMinimal[]`/`irreducibleNotMinimum[]` is bounded by the 1,024 masks and is in practice tiny (the reference run has one minimum set).
   - **Deterministic ordering.** Object keys canonical-sorted. Sets in ascending `cm` / the §8.6 step-4 order; `elements[]` in the fixed element order; `outcomes[]` in first-appearance order above; `outcomeIndex` arrays in ascending `cm`. The result is independent of the number of worker threads (every merged quantity is a sum or a deterministic minimum).
   - **Soundness gate.** `unsoundConfigurations` MUST be `[]`; any configuration with `wrong > 0` exits 2 before output (§8.6 step 2), so a conformant summary never lists one. The carrier MUST agree with the four §8.9 named correlator runs (cross-check, exit 2 on mismatch).
   - **Why retention stays bounded.** Every array above has a size fixed by the design (10 elements, 2 windows, 1,024 masks, ≤ 2,048 outcomes) or by a hard cap (the reference `ablation` is about 58.8 KB of a 197.4 KB summary; the whole summary is capped at 1,048,576 B, §6.4). Per-schedule data enters only as integer aggregates and as at most one schedule id per `firstWitness` (≤ 40 entries). The prohibited unbounded outputs are the per-schedule rows, per-schedule traces and per-schedule label tables (`witnessIndex` ≤ 468 and `traces` ≤ 16 remain the only schedule-level retention). The bitmap and the two 1,024-entry index arrays are bounded per-configuration tables, not per-schedule traces, and carry no numeric camera sample (the numeric-pose output guard applies to them).
   - Verdict words `DIAGNOSED`/`AMBIGUOUS`/`UNDIAGNOSABLE` are not written to offline outputs. The offline outputs use the counts above and the correlator's `definite`/`ambiguous`/`unavailable`/`wrong` counts (§8.9).
2. **`diag-witnesses.json`**: `kind: "g2-diagnostic-collision-witnesses"`, `schemaVersion: 2` (unchanged: the witnesses format did not change when the summary moved to v3), `synthetic: true`. Keys: `traces[{traceRef, scheduleId, configId, events[]}]` (projected traces, ≤ 16, each ≤ 163,840 B), `tracesOmitted` (the number of **unique** `traceRef` values selected by §8.8 but not retained).

Identifiers: D2 schedule ids `S-nnnnn`. Witness ids `DW-<cell>-<configId>-<question>`. `traceRef` = `<scheduleId>@<configId>`.

Suggested files (names may vary; the output names and test suffix may not): `observer.mjs` (replica + emission), `project.mjs` (projection + classing), `correlate.mjs` (R1–R8), `sufficiency.mjs` (partitions, subset search, necessity), `run-diagnostic.mjs` (CLI), and tests `*.diag-test.mjs`. The `*.diag-test.mjs` suffix keeps the suite out of `npm test`'s `*.test.mjs` glob, as D2 does.

Commands (pure offline):
```
node docs/research/2026-10-05-g2-diagnostic-instrumentation/run-diagnostic.mjs --out <empty-dir>
node --test docs/research/2026-10-05-g2-diagnostic-instrumentation/*.diag-test.mjs
node docs/research/2026-10-05-g2-diagnostic-instrumentation/run-diagnostic.mjs --out <empty-dir-2> && diff -r <empty-dir> <empty-dir-2>
```
Exit 0 means every gate passed. Exit 2 means an input-hash, conformance, cap, transitivity or correlator-soundness failure. Nothing is written in that case. The two files are written atomically **as a unit**: into a sibling staging directory that is renamed onto the (absent or empty) output directory in one step.

---

## 8. Sufficiency experiment design

### 8.1 Principle

Each hypothesis question is a **predicate over ground-truth synthetic state** (§8.2). Each tier is a **lossy projection** of the per-schedule ground-truth trace (§8.3). A schedule is **ambiguous under configuration T** iff another schedule in the same cell, with a **different** label for that question, yields a **byte-identical projected trace** under T. The pairs are reported as **collision witnesses**. "Distinguishable" therefore means the label is a function of the projected trace **within D2's closed universe**. That is a closed-world D2 result that implies no bound for a live Viewer (R §5.3), not a historical result.

### 8.2 Relevant schedules and ground-truth labels

**Relevant** means a D2 primary class in {`OWNED`, `STALE_PRIOR_TERMINAL`, `STALE_RESTORE`, `STALE_INIT`, `STALE_IN_FLIGHT`} (the T4 decision exists). Every other class is counted in `relevantCounts.excluded` and is not partitioned.

Base ground-truth axes at the subject's deciding sample:

| Axis | Domain | Ground-truth source |
|---|---|---|
| `owner` | `OWN`, `PRIOR_TERMINAL`, `IN_FLIGHT`, `RESTORE`, `INIT` | D2 class: `OWNED`→`OWN`; `STALE_PRIOR_TERMINAL`→`PRIOR_TERMINAL`; `STALE_IN_FLIGHT`→`IN_FLIGHT`; `STALE_RESTORE`→`RESTORE`; `STALE_INIT`→`INIT` |
| `subj` | `PENDING`, `ACTIVE0`, `ACTIVE_PLUS`, `COMPLETE` | D2 `subjState` at the decision |
| `active` | 0/1 | D2 `transitionActive` at the decision |
| `restore` | `NONE`, `OK_WHILE_OUTSTANDING`, `OK_WHILE_IDLE`, `NOOP` | F0/F1 → `NONE`. F2 `NOOP` → `NOOP`. F2 `OK-*` → `OK_WHILE_OUTSTANDING` iff `pending ≠ null ∨ transitionActive` immediately before the restore op executes, else `OK_WHILE_IDLE` |

Questions (fixed order; 13):

| Id | Label | Hypothesis link |
|---|---|---|
| `Q-STALE` | `owner ≠ OWN` | the core C8-type question (stale vs owned) |
| `Q-OWNER` | `owner` | axis A |
| `Q-SUBJ` | `subj` | axis B |
| `Q-ACTIVE` | `active` | transition-active at `t_d` |
| `Q-RESTORE` | `restore` | axis C |
| `Q-DH1` | `subj ∈ {PENDING, ACTIVE0}` | DH-1 (= D2 `M-PRE`) |
| `Q-DH2` | `owner=PRIOR_TERMINAL ∧ subj=PENDING ∧ active=0` | DH-2 (= D2 `M-GAP`) |
| `Q-DH3A` | `owner=RESTORE ∧ restore=OK_WHILE_OUTSTANDING` | DH-3a |
| `Q-DH3B` | `restore=OK_WHILE_OUTSTANDING ∧ owner ∈ {PRIOR_TERMINAL, IN_FLIGHT, OWN}` | DH-3b |
| `Q-DH4` | `owner = IN_FLIGHT` | DH-4 (= D2 `M-TAIL` in tail cells) |
| `Q-DH7A` | the single `T` phase between the subject's previous and deciding samples was a D2 `skip` | DH-7a (D2 representation) |
| `Q-ATTR` | ordered list of completion tokens in the window (e.g. `"1,2"`, `"2"`) | DH-5 (D2 representation) |
| `Q-TUPLE` | `owner|subj|active|restore` | full exclusive tuple; the target for the **minimum sufficient diagnostic set** |

**Label conformance:** per cell, the `Q-DH1`, `Q-DH2` and (tail cells) `Q-DH4` true-counts MUST equal D2 `mechanismCounts` `M-PRE`, `M-GAP` and `M-TAIL`, and the `Q-OWNER` counts MUST equal D2 `classCounts`. Any mismatch means exit 2.

**Not testable in D2** (reported in `interpretationLimits` with reasons, never as results): DH-6a (no foreign writer), DH-8H/8P/8∅ (D2-spec §8.3), DH-9 (A3 excludes no-op), subject-DH-10 (the subject is never discarded), DH-7b (latency is only the `G` dimension; reported as a label count only).

### 8.3 Atoms and tiers

**Base atoms (always present):** `H-CALL` (`FIT`, `RST` and `SST` events with only `f`, `k`, `s` and `rs`; the fields `r`, `cl`, `xc`, `pd`, `ac` and `ow` are added only by the ID axis or by their own atoms) and `H-T4` (`SMP` with `f`, `s`, `n`, `d`, `fr`, `cl`). The harness inherently has its own calls, restore returns and T4 samples.

**Searchable atoms**, in fixed canonical order with index 0..8: `P-FRM`, `P-XS`, `P-TICK`, `P-CC`, `P-CC0`, `P-TC`, `V-PEND`, `V-ACT`, `V-EDGE`.
- `P-FRM` adds `CAM` events and post-call `cl` on `FIT`/`RST`.
- `P-XS` adds `xc` wherever `cl` is visible.
- `V-PEND` adds `pd` and `V-ACT` adds `ac` at every visible read site.
- Each other atom adds its event kind (§6.1.1).
- `P-CC0` is [INF], unverified. It appears in the subset search but carries `inf:true`.

**Oracle atoms (not searched):** `X-OWN` (`ow` at visible read sites) and `X-TAG` (`XTC`).

**Projection.** `proj(trace, atoms, idAxis)` keeps events whose kind's atom is in `base ∪ atoms`, keeps fields whose atom is in `base ∪ atoms`, applies the identity axis (§8.4), recomputes `cl`/`xc` (§8.5) and `pd.ch` over the **visible** reads only, and serializes canonically. Equality is byte equality.

**Named configurations (9):**

| Id | Atoms (plus base) | ID axis |
|---|---|---|
| `T-PUB/OFF`, `T-PUB/ON` | `P-FRM, P-XS, P-TICK, P-CC, P-TC` | OFF / ON |
| `T-PUB+CC0/OFF`, `T-PUB+CC0/ON` | T-PUB + `P-CC0` (sensitivity, [INF]) | OFF / ON |
| `T-VB/OFF`, `T-VB/ON` | T-PUB + `V-PEND, V-ACT, V-EDGE` (no `P-CC0`) | OFF / ON |
| `T-VB+OWN/ON` | T-VB + `X-OWN` | ON |
| `T-VB+TAG/ON` | T-VB + `X-TAG` | ON |
| `T-ORACLE/ON` | T-VB + `X-OWN, X-TAG` | ON |

`T-ORACLE/ON` is expected to resolve every question. A question that is still ambiguous there is reported `UNRESOLVED_AT_ORACLE`, which is a finding about label definition, not a defect.

### 8.4 Identity axis (separate from T-VB)

Harness-tagged request identity is its **own axis** and is never folded into T-VB.
- **`ID-OFF`:** no `r` anywhere, and `pd` = `{p, ch}`.
- **`ID-ON`:** `r` on `FIT`/`SST`, and `pd` = `{p, b}` with `b` the bound token (R2).

The ID axis applies to every configuration, including the public + harness-tagged ones (where it affects only `r`). Both axes run the full subset search.

Caution: `ID-OFF` measures what is information-theoretically separable inside D2's two-request closed universe, where call order may implicitly reveal identity. It does **not** license `ORDER_ONLY` attribution in a live diagnostic (§6.2). If `ID-ON` adds no discrimination in D2, the summary MUST say "not demonstrated within D2's two-request, no-foreign-writer universe". It MUST NOT say "unnecessary".

### 8.5 Sample classing and monotonicity

- `cl`: within one projected trace, visible camera values are assigned, in order of appearance, the index of the first existing class whose **first member** satisfies `cameraSamplesWithin(·,·,1e-9)`. Otherwise they open a new class.
- `xc`: the same procedure with bitwise equality of all 32 entries.
- **Transitivity gate:** for every schedule, the 1e-9 relation over **all** camera values that the ground-truth trace contains MUST be an equivalence relation. If it is not, exit 2.
- **No pruning.** Monotonicity of sufficiency is **not assumed**. The camera-class argument does not cover the projection-local `pd.ch` bits, and their derivability under filtering is unproven. The prototype MUST evaluate **all 512 subsets** on both identity axes. It MUST report `monotonicityViolations` (the count of pairs where S ⊂ S′, S is sufficient and S′ is not, per axis × cell × question) as a finding, not a defect. "Minimal" means sufficient with no sufficient proper subset, checked directly against the full table.
- Projection keys MAY be SHA-256 digests of the canonical bytes. A digest collision can only merge blocks, which adds ambiguity and is therefore fail-safe for sufficiency claims. Every reported collision witness MUST be confirmed by byte equality.

### 8.6 Exhaustive minimal-subset search

For each identity axis × cell × question:
1. Evaluate sufficiency (zero ambiguous relevant schedules in the cell) for **all 512 subsets** of the 9 searchable atoms, with no pruning (§8.5). Base atoms are always included and oracle atoms are excluded. `subsetsEvaluated` MUST equal 512.
2. `status`: `SUFFICIENT_SETS_FOUND`, or `INSUFFICIENT_BELOW_ORACLE` (the full 9-atom set is not sufficient).
3. Report **all inclusion-minimal** sufficient subsets, sorted by the deterministic order in step 4.
4. **`recommended` is chosen only among minimal sets that contain no `inf:true` atom** (`P-CC0` is unverified and is never recommended). If no such set exists, `recommended` is `null`, and `recommendedIncludingInf` holds the best set including `P-CC0`, flagged as unverified. **Deterministic tie-break**, applied in order:
   - (i) fewest atoms;
   - (ii) fewest `V-*` atoms;
   - (iii) lexicographically smallest ascending array of canonical atom indices.

`recommended` for `Q-TUPLE` under `ID-ON` (reported for `CL-primary` and, separately, for each other cell) is the **D2 model-separability set**: the smallest atom set whose projected trace is a function of the label inside D2's closed universe. It is a closed-world fingerprint result and a closed-world result that implies **no live instrumentation bound**. It is **not** the prompt §9 minimum sufficient diagnostic set and MUST NOT drive C1, live atom selection or any instrumentation recommendation (remediation H-1).

The prompt §9 **minimum sufficient diagnostic set** ("the smallest footprint that can actually distinguish the target hypotheses") is defined against the **sound correlator** (§6.2, §8.9), not against fingerprint separability. It is found by an **exhaustive ablation** (remediation M1; `ablation.mjs`, summary key `ablation`):

1. **Candidates.** There are 10 elements: the 9 searchable atoms and the identity axis (`ID-ON`, element index 9). Base atoms are always present and oracle atoms never. All 1,024 element subsets × both slot windows (`OPEN`, `ASSUME_NO_UNOBSERVED_WRITER`) = **2,048 configurations** are evaluated with the unmodified `correlate(project(…))` on all relevant schedules (40,788, i.e. 83,533,824 correlator evaluations). Nothing is inferred and nothing is pruned. The work is split by schedule over worker threads. Every merged quantity is a sum or a deterministic minimum, so the result does not depend on the worker count.
2. **Soundness gate.** `wrong` MUST be 0 in every one of the 2,048 configurations. Otherwise the run exits 2 and names the number of unsound configurations and the first witness. The ablation is also cross-checked against the four §8.9 runs (exit 2 on any count or reason mismatch).
3. **Objective.** A configuration **satisfies** the target iff, in **both** windows, its definite counts for `Q-OWNER`, `Q-SUBJ` and `Q-ATTR` are ≥ those of the full configuration (9 atoms + `ID-ON`), with 0 wrong labels.
   - **Minimal** means satisfying with no satisfying proper subset. It is checked directly against the full 1,024-entry table, with no monotonicity assumption; `monotonicityViolations` is reported.
   - **Minimum** means a minimal set of the smallest cardinality. All minimal sets and all minimum sets are reported.
   - `canonical` is the first minimum set by the step-4 tie-break (fewest elements, then fewest `V-*` atoms, then the smallest index array), excluding any set with `P-CC0`. Every other minimum set is listed in `coMinimal`. Uniqueness is claimed only if exactly one minimum set exists.
   - Single-window lattices (`windowOnly`) are reported as well.
4. **Necessity and influence.**
   - For each element of `canonical`: the definite counts with that element removed, and the deficit versus the target.
   - For the earlier candidate bundle: every single-element removal.
   - For each element × window: the (S, S ∪ {e}) pairs and schedules where any verdict, or the definite part of a verdict, differs, both overall and above the canonical minimum.
5. **Tier tables.** Per window: the maximum definite counts, and the number of subsets that reach them, over the 128 public-only subsets (no `V-*` atom), the 512 `ID-OFF` subsets and all 1,024 subsets.

**Result (synthetic, D2 only).** The minimum is **unique** and is also the only minimal set: base (`H-CALL`, `H-T4`) + `ID-ON` + `P-FRM`, `P-TC`, `V-PEND` (VB-1), `V-EDGE` (VB-3), 5 elements. Its R3-dependent labels need the slot-window assumption (§6.2 R3). Exactly its 32 supersets satisfy the target (`monotonicityViolations` = 0). Every element is necessary. Definite counts after removing one element (`OPEN` / assumption mode):

| Removed | `Q-OWNER` | `Q-SUBJ` | `Q-ATTR` |
|---|---|---|---|
| none (= target) | 2,608 / 35,725 | 17,935 / 35,725 | 0 / 40,788 |
| `P-FRM` | **0** / **32,694** | 17,935 / **34,898** | 0 / 40,788 |
| `P-TC` | **468** / n/a† | 17,935 / n/a† | 0 / **0** |
| `V-PEND` | 2,608 / **3,193** | **0** / **0** | 0 / **0** |
| `V-EDGE` | **0** / **0** | **0** / **0** | 0 / **0** |
| `ID-ON` | 2,608 / **3,193** | **0** / **0** | 0 / **0** |

† Without `P-TC`, `Q-OWNER`/`Q-SUBJ` become `AMBIGUOUS(OBSERVABLE_ABSENT:P-TC)` after a false edge (the soundness fix below), leaving 10,917 / 20,463 definite labels in assumption mode. The necessity of `P-TC` also shows in assumption-mode `Q-ATTR` (drops to 0) and `OPEN` `Q-OWNER` (drops to 468).

`P-XS` was in the earlier candidate bundle. It is **redundant** for this objective:
- Removing it from that bundle leaves every count unchanged.
- With the minimum present, it changes no verdict on any schedule.
- It matters only without `P-FRM`. There, `xc` on the `SMP` reads restores the assumption-mode counts. So under the assumption-mode-only objective, `{P-XS, P-TC, V-PEND, V-EDGE, ID-ON}` is co-minimal with the canonical set.
- That set fails the two-window target, because it loses the 2,608 `OPEN` `RESTORE` owners. Those need `P-FRM` (the restore's own post-call read).

`P-TICK`, `P-CC`, `P-CC0` and `V-ACT` change no verdict in any configuration.

**Coverage.** Under `OPEN` the minimum answers 2 of 13 questions; under the assumption mode, 3 of 13. Only 3 of 13 questions have a sound procedure, and coverage of those depends on mode:
- Under `OPEN`, the minimum answers 2 of 13 at all: `Q-OWNER` 2,608 and `Q-SUBJ` 17,935 of 40,788 definite. `Q-ATTR` has 0 definite labels in every configuration.
- Under the assumption mode, it answers 3 of 13 (35,725 / 35,725 / 40,788). Only `Q-ATTR` is answered fully. The residual is 5,063 per question, all `ACTIVE_WITHOUT_VISIBLE_STEP`, all ground-truth `ACTIVE0` (DH-1).
- The other 10 questions are procedure-limited (C1 `NO_SOUND_PROCEDURE`), not atom-limited.

**Public-only** subsets (all 128 × 2 windows) give 0 definite `Q-OWNER`, `Q-SUBJ` and `Q-ATTR` labels. **`ID-OFF`** subsets give 0 definite `Q-SUBJ`/`Q-ATTR` labels, and at most 2,608 / 3,193 definite `Q-OWNER` labels.

**Soundness defect found by the ablation, fixed (M1).** Before the fix, 64 of the 2,048 configurations emitted wrong definite labels: the assumption mode with `V-PEND`, `V-EDGE` and `ID-ON` present and `P-TC` absent (for example `[V-PEND, V-EDGE, ID-ON]`: `Q-OWNER` 12,223 wrong, `Q-SUBJ` 8,463 wrong; first witness `S-00001`, which emitted `IN_FLIGHT` / `ACTIVE_PLUS` where the truth is `OWN` / `COMPLETE`). Cause: in the `AE ev = 0` branch a false edge did not end the active transition when `TC` is not observed, so that transition's terminal camera write was credited to it as in-flight motion. Per §8.9 the correlator was made more conservative, not the check relaxed: after a false edge without `P-TC` the active token is cleared and the trace is flagged `hiddenTerminal`, which makes `Q-OWNER` and `Q-SUBJ` `AMBIGUOUS(OBSERVABLE_ABSENT:P-TC)`. The fix only converts definite labels to ambiguous ones, so no named run (all contain `P-TC`) and no verdict of the minimum bundle changes. The soundness gate (`wrong` = 0 in every one of the 2,048 configurations) passes.

The R §9 rows are derived as follows:
- **minimum sufficient diagnostic set:** `ablation.canonical`, with `coMinimal` (empty here) and `windowOnly`;
- **nice-to-have:** atoms outside the minimum that occur in some but not all §8.6 separability minimal sets for a target question;
- **redundant:** for the sound-correlator objective, every atom outside the minimum (`P-XS`, `P-TICK`, `P-CC`, `P-CC0`, `V-ACT`); under the separability definition, atoms in no minimal set for any question in any CL cell;
- **unsafe/unnecessary:** the analytic list in R §9.

### 8.7 Necessity answers (prompt §8)

Per cell × question, using the §8.6 results:

| Field | Value rule |
|---|---|
| `requestIdentity` | `NECESSARY` iff no `ID-OFF` subset is sufficient but some `ID-ON` subset is. `NOT_DEMONSTRATED_IN_D2` iff some `ID-OFF` subset is sufficient. `INSUFFICIENT_BELOW_ORACLE` iff neither |
| `transitionActive` (`V-ACT` or `V-EDGE`) | under `ID-ON`: `NECESSARY` iff minimal sets exist and **every** one contains `V-ACT` or `V-EDGE`. `NOT_NECESSARY_IN_D2` iff some minimal set contains neither. `INSUFFICIENT_BELOW_ORACLE` otherwise |
| `pendingSlot` (`V-PEND`) | same rule with {`V-PEND`} |
| `formalCompletionPublic` (`P-TC`) | same rule with {`P-TC`} |
| `cameraWriteOwnership` (`X-OWN`) | `NOT_NECESSARY_IN_D2` iff some non-oracle `ID-ON` subset is sufficient. Else `RESOLVED_BY_NAMED_BUNDLE` iff `T-VB+OWN/ON` is sufficient. Else `NOT_RESOLVED_BY_NAMED_BUNDLE`. The two bundle values describe **one named bundle only**: oracle atoms are not searched in combination with other subsets, so they MUST NOT be read as necessity or insufficiency of `X-OWN` |
| `requestTaggedCompletion` (`X-TAG`) | the same rule, with `T-VB+TAG/ON` |

Fractions per tier (prompt §8 "what fraction … public-only") come from `sufficiency` for the named configurations.

### 8.8 Collision witnesses (bounded, deterministic)

For each cell × named configuration × question with ≥ 1 ambiguous schedule, record one pair:
- `scheduleA` = the lowest ambiguous schedule id;
- `scheduleB` = the lowest id in A's block whose label differs.

This gives at most 468 entries. Full projected traces (both members) are retained for `question ∈ {Q-STALE, Q-TUPLE}` × `config ∈ {T-PUB/OFF, T-VB/ON}` × `cell ∈ {CL-primary, CL-tail}`, in that nested order. They are deduplicated by `traceRef` and capped at 16 (§6.4). Other entries carry only `projectionDigest`.

### 8.9 Correlator evaluation

The R1–R8 correlator (§6.2) is run for `Q-OWNER`, `Q-SUBJ` and `Q-ATTR` on every relevant schedule, as four runs: `T-PUB/ON`, `T-VB/OFF` and `T-VB/ON` in assumption mode (`ASSUME_NO_UNOBSERVED_WRITER`, true in D2 by construction), and `T-VB/ON@OPEN` (`T-VB/ON` atoms in the fail-closed `OPEN` mode, the open-world-sound reference). `wrong` MUST be 0 (otherwise exit 2). The same gate applies to every one of the 2,048 §8.6 ablation configurations. `definite`, `ambiguous` and `unavailable` are reported. If soundness fails during development, the correlator rules MUST be made **more conservative** (more `AMBIGUOUS`), never the check relaxed. Any such change to the §6.2 procedure is recorded as a spec deviation for internal review. A gap between information-theoretic distinguishability (§8.6) and correlator definiteness is reported as a finding. It is not a defect.

### 8.10 Required research-local tests (prompt §11), minimum

Schema validation (field and class tags, per-event byte cap at exactly the cap and at cap+1). Request correlation (R2/R3). Ambiguous identity (`"U"` binding, then `AMBIGUOUS`). Missing pending-slot identity (V-PEND absent, then `UNAVAILABLE`/`AMBIGUOUS`). Transition ownership (R3/R4). Restore interaction (R6, including an `OK_WHILE_OUTSTANDING` overwrite). T4 sample correlation (R7). C8/frustum timing (`fr` on the deciding sample only, R8). Event-count overflow at 1,024 versus 1,025. Contradictory ordering (C3). VB-0 failure disables all `V-*` atoms (C6). Projection monotonicity and the transitivity gate. Deterministic output (two runs byte-identical). At least one public + harness-tagged ambiguity case and one version-bound resolution case, each taken from actual witnesses. Conformance-gate failure (a corrupted replica field or decision-time row means exit 2). R2 no-op rebinding: a hand-built trace where the post-call slot object equals the pre-call object MUST yield `NO_REQUEST_OR_UNRESOLVED` and no rebinding. Live `END` reserve: a hand-built trace filled to the data-byte limit still writes `END` within the total cap. `NV` encoding: worst-case size equals 406 B or less for arbitrary finite doubles (400 B before the integrity sequence `q` was added). Minimal-set extraction is checked against the full 512-subset table (no pruning). **Added by remediation:** schema totality (bare `SMP`/`AE`, slot invariants such as `pd:{p:0,b:1}`, prototype-key kinds and fields such as `toString`, `META`/`END` validators, recorder validation before mutation); correlator totality (malformed traces and configurations give `UNDIAGNOSABLE(MALFORMED)`, never an exception); the VB guard failing closed on missing, partial or malformed `vg`/`vb`/`pc`; the H-2 pair (normal consumption vs foreign overwrite-then-consume, byte-identical under `T-VB/ON`, separated only by the SYN owner tag), showing assumption-mode labels that would be wrong in the foreign world and `AMBIGUOUS(UNOBSERVED_SLOT_WINDOW)` in `OPEN` mode; an `f`-ablation of `T-PUB` separability; staged unit-atomic output writing. **Added by the H1/M2 correction:** VB-0 exact pin (`vb0.diag-test.mjs`: only `"7.124.2"` + the pinned digest is eligible; `7.124.1`, `7.125.x` incl. the reproduced H1 record, missing/malformed/wrong-type `vv` and `vd`, `vg = 1` with a wrong build — each rejected by both `validateMeta` and `applyVbGuard`; no fallback after rejection: the verdict is the C6 `VB_UNAVAILABLE:VB-0` ambiguity); whole-trace integrity (`integrity.diag-test.mjs`: a recorder-produced stream passes, one mutation per §6.1.3 integrity code is rejected with that code, partial traces are never valid, envelope-bound VB gating, totality on garbage/prototype/proxy input). **Added by M1:** `ablation.diag-test.mjs` checks the ablation extraction on synthetic tables (two co-minimal sets, never reported as unique; a non-monotone case) and the hard gate on any wrong label. Over a deterministic real subsample and all 2,048 configurations, it checks the exhaustive count, order-independent merging, `P-XS` redundancy, the necessity of every minimum element, 0 definite `Q-SUBJ`/`Q-ATTR` for `ID-OFF`, and 0 definite labels of any kind for public-only.

### 8.11 Determinism

Two runs from clean, empty output directories MUST produce byte-identical files, with equal `outputDigestSha256` and `companionDigestSha256`, stable `S-nnnnn` schedule ids and witness ids, and identical classification. There is no randomness and no time-dependent value in outputs.

---

## 9. Interpretation limits (to be carried into outputs)

1. Every result is **synthetic** and holds only within D2's closed universe: two requests, no foreign writer, no no-op, the subject never discarded, finite domains (D2-spec §7.6), and the modelling mapping of §7.3.
2. Public + harness-tagged (`T-PUB`) sufficiency measured here is a closed-world D2 result; it is **not a bound** on live separability, and implies no live bound (upper or lower) either: D2 excludes foreign writers, no-op fits, subject discard, jitter and alternative live observables.
3. No result proves historical causality. C8 stays unresolved, C6 stays `NOT_EVIDENCED`, and T4 is unchanged.
4. Version-bound atoms remain diagnostic/research-only even if shown necessary.
5. D=30 is not simulated and supports no inference.
6. §8.6 minimal sets are closed-world fingerprint results (inside D2 event order determines every label; `f` adds trace uniqueness only, and some separability is definitional). They are **closed-world D2 results that imply no live instrumentation bound** (and the separability fractions are closed-world D2 results, **not bounds on live separability**), never instrumentation recommendations.
7. Under `OPEN` the §8.6 minimum answers 2 of 13 questions; under the assumption mode, 3 of 13 (only 3 of 13 questions have a sound procedure). Its assumption-mode labels depend on the unverifiable "no unobserved writer" assumption (§6.2 R3); only `slotWindow = OPEN` results are independent of it, and an identical-value camera write stays invisible in both modes.

## 10. Open decisions for the owner (none decided here)

1. Whether any future live diagnostic is authorized at all, and with which atoms (informed by the §8.6 **minimum sufficient diagnostic set** `ablation.canonical`, not by the `recommended` fingerprint sets; it is a closed-world D2 result that implies no live bound, and a live need may be larger or different).
1a. Whether a live diagnostic may use the R3 assumption mode (`ASSUME_NO_UNOBSERVED_WRITER`), and what verification gate would justify it; the default is `OPEN`.
2. Whether VB-1…VB-3 may be used in such a diagnostic (policy: D2-spec §13.1).
3. Whether the offline outputs are ever checkpointed as evidence (default: research-local reference only).

## Appendix A: Internal review log

The package-level internal review (`docs/reviews/2026-10-05-g2-diagnostic-instrumentation-internal-review.md`, 0C/2H/6M/6L) was remediated in place; its "Remediation" section maps each finding to the changed sections (§6.1.2, §6.1.3, §6.2 R2/R3 and pseudo-code, §6.3 C1/C6/C8, §7.4, §8.6, §8.9, §8.10, §9, §10). The table below is the earlier spec-level review of v1.


A Codex spec review (`codex-review spec`, medium, request `20261005-100751-49082-24845`) of v1 reported 3 Critical and 5 High findings. All were remediated in this v2 and none was dismissed.

| Finding | Disposition | Section |
|---|---|---|
| C-1: a no-op fit could rebind an older pending request to the new token | Fixed. R2 now uses pre- and post-call reads (`pq`, `nw`), and an unchanged object yields `NO_REQUEST_OR_UNRESOLVED`. Unit test added. The domain note records that D2 cannot exercise this branch | §6.2 R2, §6.1.2, §8.10 |
| C-2: the conformance gate did not validate the decision-time axes that labels use | Fixed. D2's own bounded trace rows (`trace:true`) are now the trusted surface. Row-by-row state, deciding-row `subj`/`active`, and the restore pre-state are all compared | §7.2 |
| C-3: `META`/`END` and overflow accounting were unimplementable | Fixed. Full field tables were added, a 2,048 B reserve is set aside, and total bytes include delimiters and `META`/`END` | §6.1.3, §6.4(b) |
| I-1: monotone pruning was unjustified for `pd.ch` | Fixed. Pruning is removed, all 512 subsets are evaluated, and `monotonicityViolations` is reported | §8.5, §8.6 |
| I-2: the correlator was not deterministic | Fixed. A normative single-pass procedure with output precedence was added | §6.2 |
| I-3: `nv` could exceed the per-event cap | Fixed. `nv` is now a fixed-width base64 binary64 on a dedicated `NV` record with a 400 B cap at that review (since corrected to **406 B** to include the stamped `"q":8192,` field, §6.4(b); 406 B is the current normative and tested bound) | §6.1.2, §6.4(b) |
| I-4: label and collection encodings were underspecified | Fixed. Normative encodings, ordering, bounds, and `synthetic` placement were added | §7.4 |
| I-5: oracle "necessity" was inferred from a single named bundle | Fixed. The values were renamed to `RESOLVED_BY_NAMED_BUNDLE` / `NOT_RESOLVED_BY_NAMED_BUNDLE`, and necessity interpretation is prohibited | §8.7 |
| Q2: `P-CC0` could become `recommended` | Fixed. `recommended` excludes `inf:true` atoms, and `recommendedIncludingInf` is reported separately | §8.6 |
| Q3: `tm` monotonicity | Clarified as non-decreasing after quantization | §6.1.2 |
| Q4: `tracesOmitted` | Clarified as unique `traceRef` values | §7.4 |
| Q5: verdict words offline | Clarified as not written offline | §7.4 |
| Q1: concurrent pending at fit call | Answered by C-1 (pre-call capture is mandatory) | §6.2 R2 |
