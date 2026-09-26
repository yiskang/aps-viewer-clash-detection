// Presence guard for the production modules that exist at each checkpoint. Each task that creates a module
// clashpanel/<path>.js appends <path>.js to EXPECTED_MODULES in the SAME task (so this file is RED inside a task
// before the module exists and GREEN at that task's commit; it is never committed red). The second test fails on a
// module that exists but is not listed, so a forgotten entry cannot slip through.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = fileURLToPath(new URL('../../clashpanel/', import.meta.url));
const EXPECTED_MODULES = [
  'core/constants.js',
  'core/scheduler.js',
  'core/generation.js',
  'core/ports.js',
  'core/draft.js',
  'core/setupValidation.js',
  'core/softAvailability.js',
  'core/derivationQueue.js',
  'core/runMachine.js',
  'core/residency.js',
  'core/resultIndex.js',
  'core/runReport.js',
  'core/filters.js',
  'core/grouping.js',
  'core/orderedList.js',
  'core/labels.js',
  'core/resolve.js',
  'core/rows.js',
  'core/intents.js',
  'core/controller.js',
  'core/viewModel.js',
  'core/index.js',
  'viewer/ViewerBridge.js',
  'viewer/markers.js',
  'viewer/isolation.js',
  'viewer/fit.js',
  'viewer/viewerApi.js',
  'ui/dom.js',
  'ui/render/setup.js',
  'ui/render/run.js',
  'ui/render/filters.js',
  'ui/render/results.js',
];

const walk = (dir) => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? walk(p) : [p];
});

test('scaffold: every production module created so far exists', () => {
  for (const name of EXPECTED_MODULES) assert.ok(existsSync(join(DIR, name)), `clashpanel/${name} is missing`);
});

test('scaffold: no clashpanel/**/*.js file exists that the scaffold does not list', () => {
  const found = walk(DIR).filter((f) => f.endsWith('.js')).map((f) => relative(DIR, f).split(sep).join('/')).sort();
  assert.deepEqual(found, [...EXPECTED_MODULES].sort());
});
