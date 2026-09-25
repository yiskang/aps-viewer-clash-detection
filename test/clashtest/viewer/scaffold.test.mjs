// test/clashtest/viewer/scaffold.test.mjs
// Presence guard for the production modules that exist at each checkpoint. Each task that creates a module
// clashtest/viewer/<name>.js appends <name>.js to EXPECTED_MODULES in the SAME task (so this file is RED
// inside a task before the module exists and GREEN at that task's commit; it is never committed red).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = fileURLToPath(new URL('../../../clashtest/viewer/', import.meta.url));
const EXPECTED_MODULES = ['errors.js', 'checkpoint.js', 'readiness.js'];

test('scaffold: every production module created so far exists', () => {
  for (const name of EXPECTED_MODULES) assert.ok(existsSync(join(DIR, name)), `clashtest/viewer/${name} is missing`);
});
