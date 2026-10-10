// test/clashpanel/dom/support/managerFixtures.mjs — plain-JSON Clash Tests manager ViewModels for the DOM tests
// (browser-importable; no Node APIs). Shape: clashpanel/core/managerViewModel.js buildManagerViewModel.
import { panelVm } from './vmFixtures.mjs';

const ALLOW = { enabled: true, reason: null };

export function managerRow(i, over = {}) {
  return {
    testId: `T-${i}`, name: `Clash test ${i}`, active: i === 1, modeText: 'Hard', setA: 'Architecture', setB: 'Structure',
    status: { kind: 'not-run', text: 'Not run' }, resultCount: null, resultsText: null, setupChangedSinceRun: false,
    readiness: { state: 'setup-complete', text: 'Setup complete — readiness to run is checked when opened', models: [] },
    modelsChanged: false, modelsChangedText: null,
    actions: { open: ALLOW, duplicate: ALLOW, reset: { enabled: false, reason: 'This test has no results to reset.' }, delete: ALLOW },
    ...over,
  };
}

export function managerVm(over = {}) {
  const tests = over.tests ?? [managerRow(1), managerRow(2)];
  return {
    view: 'list', activeTestId: 'T-1', activeName: 'Clash test 1', count: tests.length, create: ALLOW,
    pending: null, confirm: null, notice: null, fault: null, editorLock: null, live: '', liveSeq: 0, runActiveReason: 'Stop the running test first.', tests, ...over,
  };
}

export function managedVm(manager = {}, editor = {}) {
  return { manager: managerVm(manager), editor: panelVm(editor) };
}
