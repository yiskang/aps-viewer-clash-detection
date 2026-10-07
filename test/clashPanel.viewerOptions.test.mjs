import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveViewerOptions, initializerOptions } from '../wwwroot/viewerOptions.js';

test('default (no / unrelated / legacy-off query) = SVF2 + panel, demo off', () => {
  for (const s of ['', '?', '?foo=1', undefined, null, 42, '?svf2=0', '?svf2=', '?clashPanel=no']) {
    assert.deepEqual(resolveViewerOptions(s), { svf2: true, clashPanel: true, demo: false }, String(s));
  }
});

test('svf2=1 and clashPanel=1 are harmless legacy aliases', () => {
  for (const s of ['?svf2=1', '?clashPanel=1', '?x=2&svf2=true', '?clashPanel=TRUE']) {
    assert.deepEqual(resolveViewerOptions(s), { svf2: true, clashPanel: true, demo: false }, s);
  }
});

test('clashPanelDemo=1 only adds demo; the panel does not depend on it', () => {
  assert.deepEqual(resolveViewerOptions('?clashPanelDemo=1'), { svf2: true, clashPanel: true, demo: true });
  assert.equal(resolveViewerOptions('').demo, false);
  assert.equal(resolveViewerOptions('').clashPanel, true);
});

test('default URL yields the SVF2 initializer options', () => {
  const tok = () => {};
  assert.deepEqual(initializerOptions(resolveViewerOptions(''), tok), { env: 'AutodeskProduction2', api: 'streamingV2', getAccessToken: tok });
});

test('initializer options: svf2:false -> SVF, svf2:true -> SVF2 streamingV2', () => {
  const tok = () => {};
  assert.deepEqual(initializerOptions({ svf2: false }, tok), { env: 'AutodeskProduction', getAccessToken: tok });
  assert.deepEqual(initializerOptions({ svf2: true }, tok), { env: 'AutodeskProduction2', api: 'streamingV2', getAccessToken: tok });
});
