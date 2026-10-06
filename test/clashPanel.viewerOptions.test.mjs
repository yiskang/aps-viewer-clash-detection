import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveViewerOptions, initializerOptions } from '../wwwroot/viewerOptions.js';

test('default (no / unrelated query) keeps legacy behaviour', () => {
  for (const s of ['', '?', '?foo=1', undefined, null, 42, '?svf2=0', '?svf2=', '?clashPanel=no']) {
    assert.deepEqual(resolveViewerOptions(s), { svf2: false, clashPanel: false, demo: false }, String(s));
  }
});

test('svf2=1 and clashPanel=1 opt in to SVF2 + the panel extension', () => {
  for (const s of ['?svf2=1', '?clashPanel=1', '?x=2&svf2=true', '?clashPanel=TRUE']) {
    assert.deepEqual(resolveViewerOptions(s), { svf2: true, clashPanel: true, demo: false }, s);
  }
});

test('clashPanelDemo=1 implies the opt-in', () => {
  assert.deepEqual(resolveViewerOptions('?clashPanelDemo=1'), { svf2: true, clashPanel: true, demo: true });
});

test('initializer options: SVF default, SVF2 streamingV2 on opt-in', () => {
  const tok = () => {};
  assert.deepEqual(initializerOptions({ svf2: false }, tok), { env: 'AutodeskProduction', getAccessToken: tok });
  assert.deepEqual(initializerOptions({ svf2: true }, tok), { env: 'AutodeskProduction2', api: 'streamingV2', getAccessToken: tok });
});
