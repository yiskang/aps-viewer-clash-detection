// Worker thread for the exhaustive ablation (ablation.mjs). [SYN] research tooling only.
// workerData = { k, n, loadOpts: {paths?, expected?}, records }. The worker re-loads the pinned inputs itself (same
// read-once/hash gate as the main thread), checks that its input records equal the main thread's (the observed-only
// thisSpec record excepted), enumerates the D2 schedules, and ablates every relevant schedule whose enumeration index
// i satisfies i % n === k. It posts { acc, relevantByCell } or { error: {code, message} }.
import { parentPort, workerData } from 'node:worker_threads';
import { loadPinned } from './pins.mjs';
import { observeSchedule, labelsOf, QUESTION_IDS } from './observer.mjs';
import { newAccumulator, ablateSchedule } from './ablation.mjs';

const { k, n, loadOpts, records: mainRecords } = workerData;
try {
  const { records, fixtures: fx, mods } = await loadPinned(loadOpts);
  for (const name of Object.keys(mainRecords)) {
    if (name === 'thisSpec') continue;
    if (JSON.stringify(records[name]) !== JSON.stringify(mainRecords[name])) throw Object.assign(new Error(`INPUT-HASH: worker input ${name} differs from the main thread`), { code: 'INPUT-HASH' });
  }
  const d2 = { ...mods.contract, ...mods.machine };
  const within = mods.contract.cameraSamplesWithin;
  const schedules = mods.schedules.enumerateSchedules(fx.domains);
  const acc = newAccumulator();
  const relevantByCell = {};
  const qi = (q) => QUESTION_IDS.indexOf(q);
  for (let i = k; i < schedules.length; i += n) {
    const s = schedules[i];
    const obs = observeSchedule(s, fx, d2);
    if (!obs.gt) continue;
    const L = labelsOf(obs.gt);
    relevantByCell[s.cell] = (relevantByCell[s.cell] || 0) + 1;
    ablateSchedule(obs.events, { 'Q-OWNER': L[qi('Q-OWNER')], 'Q-SUBJ': L[qi('Q-SUBJ')], 'Q-ATTR': L[qi('Q-ATTR')] }, within, acc, i, s.id);
  }
  parentPort.postMessage({ acc, relevantByCell });
} catch (e) {
  parentPort.postMessage({ error: { code: e.code || 'ERROR', message: e.message } });
}
