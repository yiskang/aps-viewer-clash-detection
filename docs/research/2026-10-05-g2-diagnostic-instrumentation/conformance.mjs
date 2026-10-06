// Mandatory conformance gate (spec §7.2): the observer replica must reproduce D2 runSchedule on every schedule,
// field by field AND against D2's own bounded trace rows (the trusted decision-time surface). Any mismatch => exit 2.
import { fail } from './pins.mjs';

export const FIELDS_CHECKED = ['cls', 'labels', 'inv', 'oracle', 't4Frame', 't4Samples', 'shadowEnd', 'terminalTokens', 'tokenLog', 'finalOwner'];

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Field comparison (replica `obs.res` vs D2 result). Returns list of mismatching field names. */
export function compareFields(obs, d2res) {
  const bad = [];
  for (const k of FIELDS_CHECKED) {
    const a = obs.res[k];
    const b = k === 'oracle' ? d2res.oracle : d2res[k];
    if (!same(a, b)) bad.push(k);
  }
  return bad;
}

const rowEq = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * Row checks (a)-(d). `d2rows` are D2's own trace rows. Returns { ok, reason, rowsChecked }.
 */
export function compareRows(obs, d2rows) {
  // (a) ordered subsequence with identical state columns (we compare the full row, which is stricter)
  let j = 0;
  for (const r of d2rows) {
    while (j < obs.rows.length && !rowEq(obs.rows[j], r)) j += 1;
    if (j >= obs.rows.length) return { ok: false, reason: `(a) D2 row not matched: ${JSON.stringify(r)}`, rowsChecked: 0 };
    j += 1;
  }
  const subject = obs.meta.subject;
  // (b) deciding-sample row of the subject settle
  if (obs.gt) {
    const dec = d2rows.filter((r) => r[1] === 'H' && /^ss\d+$/.test(r[2]) && (r[8] === 'settled' || r[8] === 'timeout'));
    if (dec.length !== 1) return { ok: false, reason: `(b) expected one subject deciding row, got ${dec.length}`, rowsChecked: 0 };
    const [, , , pendingToken, activeToken, progress, , transitionActive] = dec[0];
    let subj;
    if (pendingToken === subject) subj = 'PENDING';
    else if (activeToken === subject && progress === 0) subj = 'ACTIVE0';
    else if (activeToken === subject && progress >= 1) subj = 'ACTIVE_PLUS';
    else subj = 'COMPLETE';
    if (subj !== obs.gt.subj) return { ok: false, reason: `(b) subj ${subj} != replica ${obs.gt.subj}`, rowsChecked: 0 };
    if (String(transitionActive) !== obs.gt.active) return { ok: false, reason: '(b) active mismatch', rowsChecked: 0 };
    // (c) restore pre-state
    const rr = d2rows.filter((r) => r[2] === 'restoreOK' || r[2] === 'restoreNOOP');
    if (obs.gt.restore === 'NONE') {
      if (rr.length !== 0) return { ok: false, reason: '(c) restore row present for NONE', rowsChecked: 0 };
    } else {
      if (rr.length !== 1) return { ok: false, reason: `(c) expected one restore row, got ${rr.length}`, rowsChecked: 0 };
      const outstanding = rr[0][3] !== 0 || rr[0][7] === 1;
      const want = rr[0][2] === 'restoreNOOP' ? 'NOOP' : (outstanding ? 'OK_WHILE_OUTSTANDING' : 'OK_WHILE_IDLE');
      if (want !== obs.gt.restore) return { ok: false, reason: `(c) restore ${want} != replica ${obs.gt.restore}`, rowsChecked: 0 };
    }
  }
  // (d) consN / skip / final rows vs replica AE(ev=1) / skip / TC emission frames
  const d2cons = d2rows.filter((r) => /^cons\d$/.test(r[2])).map((r) => r[0]);
  const d2skip = d2rows.filter((r) => r[2] === 'skip').map((r) => r[0]);
  const d2fin = d2rows.filter((r) => r[2] === 'final').map((r) => r[0]);
  const aeT = obs.events.filter((e) => e.k === 'AE' && e.ev === 1).map((e) => e.f);
  const tc = obs.events.filter((e) => e.k === 'TC').map((e) => e.f);
  const skips = Object.keys(obs.meta.tOutcome).map(Number).sort((a, b) => a - b).filter((f) => obs.meta.tOutcome[f] === 'skip');
  if (!same(d2cons, aeT)) return { ok: false, reason: '(d) cons/AE frames differ', rowsChecked: 0 };
  if (!same(d2skip, skips)) return { ok: false, reason: '(d) skip frames differ', rowsChecked: 0 };
  if (!same(d2fin, tc)) return { ok: false, reason: '(d) final/TC frames differ', rowsChecked: 0 };
  return { ok: true, reason: null, rowsChecked: d2rows.length };
}

/** Runs the full gate for one schedule; throws exit-2 CONFORMANCE on any mismatch. Returns rows checked. */
export function checkSchedule(sch, obs, fx, machine) {
  const plain = machine.runSchedule(sch, fx);
  const badFields = compareFields(obs, plain);
  if (badFields.length) throw fail('CONFORMANCE', `${sch.id}: replica field mismatch: ${badFields.join(', ')}`);
  const traced = machine.runSchedule(sch, fx, { trace: true });
  const badTraced = compareFields(obs, traced);
  if (badTraced.length) throw fail('CONFORMANCE', `${sch.id}: replica field mismatch (trace run): ${badTraced.join(', ')}`);
  const rc = compareRows(obs, traced.trace);
  if (!rc.ok) throw fail('CONFORMANCE', `${sch.id}: ${rc.reason}`);
  return rc.rowsChecked;
}

/** Aggregate equalities vs d2-summary.json (classCounts, mechanismCounts, counts). Throws exit 2 on mismatch. */
export function checkAggregates({ classCounts, mechanismCounts, cellCounts, total }, d2Summary, fx) {
  if (total !== fx.expectedCounts.total || total !== d2Summary.enumerationCount) throw fail('CONFORMANCE', `enumeration ${total}`);
  for (const c of Object.keys(fx.expectedCounts.cells)) {
    if (cellCounts[c] !== fx.expectedCounts.cells[c]) throw fail('CONFORMANCE', `cell ${c} count ${cellCounts[c]}`);
  }
  const norm = (o) => JSON.stringify(o, Object.keys(o).sort());
  for (const c of Object.keys(d2Summary.classCounts)) {
    for (const fam of Object.keys(d2Summary.classCounts[c])) {
      for (const k of Object.keys(d2Summary.classCounts[c][fam])) {
        const got = ((classCounts[c] || {})[fam] || {})[k] || 0;
        if (got !== d2Summary.classCounts[c][fam][k]) throw fail('CONFORMANCE', `classCounts ${c}/${fam}/${k}: ${got} != ${d2Summary.classCounts[c][fam][k]}`);
      }
    }
  }
  for (const c of Object.keys(classCounts)) for (const fam of Object.keys(classCounts[c])) for (const k of Object.keys(classCounts[c][fam])) {
    if (classCounts[c][fam][k] && !(((d2Summary.classCounts[c] || {})[fam] || {})[k])) throw fail('CONFORMANCE', `extra class ${c}/${fam}/${k}`);
  }
  for (const c of Object.keys({ ...d2Summary.mechanismCounts, ...mechanismCounts })) {
    const a = d2Summary.mechanismCounts[c] || {}; const b = mechanismCounts[c] || {};
    if (norm(a) !== norm(b) || Object.keys(a).some((k) => a[k] !== b[k])) throw fail('CONFORMANCE', `mechanismCounts ${c}`);
  }
}
