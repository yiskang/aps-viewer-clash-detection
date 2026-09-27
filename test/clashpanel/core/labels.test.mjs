// test/clashpanel/core/labels.test.mjs — spec §8.2, §10.1, §12.4, AC-P13 (raw strings; UI escapes)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLabelResolver, fallbackModelName, readNodeName } from '../../../clashpanel/core/labels.js';
import { LABEL_CACHE_MAX, LIST_CHUNK_SIZE } from '../../../clashpanel/core/constants.js';
import { createFakeScheduler } from '../support/fakeScheduler.mjs';
import { drain } from '../support/settle.mjs';

function fakeModel(names, counter = { reads: 0 }) {
  return {
    counter,
    getObjectTree() {
      return { getNodeName(dbId) { counter.reads += 1; return names[dbId]; } };
    },
  };
}

function setup({ live = {}, names = { mA: 'Architecture', mB: 'Structure' } } = {}) {
  const scheduler = createFakeScheduler();
  const catalog = { displayNameFor: (key) => names[key] ?? null };
  const liveModels = { ...live };
  const labels = createLabelResolver({ catalog, resolveLiveModel: (key) => liveModels[key] ?? null, scheduler });
  return { labels, scheduler, liveModels };
}

function indexOf(records) {
  return { count: records.length, at: (i) => records[i] };
}

test('model names: host display name, else "Model <first 8 chars>"', () => {
  const { labels } = setup();
  assert.equal(labels.modelName('mA'), 'Architecture');
  assert.equal(labels.modelName('0123456789abcdef'), 'Model 01234567');
  assert.equal(fallbackModelName('short'), 'Model short');
  const throwing = createLabelResolver({ catalog: { displayNameFor() { throw new Error('x'); } }, resolveLiveModel: () => null, scheduler: createFakeScheduler() });
  assert.equal(throwing.modelName('mZ'), 'Model mZ');
});

test('RF-2: duplicate display names are disambiguated by a stable key suffix; unique, empty and blank names behave', () => {
  const hostile = '<img src=x onerror=alert(1)>';
  const names = { 'k-0001-3f2a': 'Model', 'k-0002-9c1d': 'Model', mU: 'Unique', h1: hostile, h2: hostile, blank: '   ', empty: '' };
  const catalog = {
    list: () => ['k-0001-3f2a', 'k-0002-9c1d', 'mU', 'h1', 'h2', 'blank', 'empty'].map((modelKey) => ({ modelKey, displayName: names[modelKey], model: {}, loaded: true })),
    displayNameFor: (key) => names[key] ?? null,
  };
  const labels = createLabelResolver({ catalog, resolveLiveModel: () => null, scheduler: createFakeScheduler() });
  assert.equal(labels.modelName('k-0001-3f2a'), 'Model · …3f2a');
  assert.equal(labels.modelName('k-0002-9c1d'), 'Model · …9c1d');
  assert.equal(labels.modelName('mU'), 'Unique');                          // unique names never change
  assert.equal(labels.modelName('h1'), `${hostile} · …h1`);                // raw text, still distinguishable
  assert.equal(labels.modelName('h2'), `${hostile} · …h2`);
  assert.equal(labels.modelName('blank'), 'Model blank');                  // blank ⇒ the existing fallback
  assert.equal(labels.modelName('empty'), 'Model empty');
  assert.equal(labels.modelName('k-0001-3f2a'), labels.modelName('k-0001-3f2a'));   // deterministic
  // Suffix collision ⇒ the full key; a model known only from the displayed run (unloaded) still counts.
  const n2 = { 'a-xx-1234': 'Pipe', 'b-yy-1234': 'Pipe', gone: 'Solo', here: 'Solo' };
  const c2 = { list: () => [{ modelKey: 'a-xx-1234' }, { modelKey: 'b-yy-1234' }, { modelKey: 'here' }], displayNameFor: (k) => n2[k] ?? null };
  const known = [];
  const l2 = createLabelResolver({ catalog: c2, resolveLiveModel: () => null, scheduler: createFakeScheduler(), knownModelKeys: () => known });
  assert.equal(l2.modelName('a-xx-1234'), 'Pipe · …a-xx-1234');
  assert.equal(l2.modelName('here'), 'Solo');
  known.push('gone');
  l2.invalidateNames();
  assert.equal(l2.modelName('here'), 'Solo · …here');
  assert.equal(l2.modelName('gone'), 'Solo · …gone');
});

test('element label: live model name via getObjectTree().getNodeName, else #dbId', () => {
  const { labels, liveModels } = setup({ live: { mA: fakeModel({ 1: 'Wall-102' }) } });
  assert.equal(labels.elementLabel({ modelKey: 'mA', dbId: 1 }), 'Wall-102');
  assert.equal(labels.elementLabel({ modelKey: 'mA', dbId: 2 }), '#2');        // tree has no name
  assert.equal(labels.elementLabel({ modelKey: 'mB', dbId: 10 }), '#10');      // model not live
  delete liveModels.mA;                                                         // unloaded afterwards
  assert.equal(labels.elementLabel({ modelKey: 'mA', dbId: 1 }), '#1');        // cached name is not shown for an unloaded model
});

test('getObjectTree/getNodeName failures are guarded', () => {
  assert.equal(readNodeName({ getObjectTree() { throw new Error('not ready'); } }, 1), null);
  assert.equal(readNodeName({ getObjectTree: () => null }, 1), null);
  assert.equal(readNodeName({}, 1), null);
  assert.equal(readNodeName({ getObjectTree: () => ({ getNodeName: () => '' }) }, 1), null);
});

test('AC-P13: markup-bearing names are returned verbatim (escaping is the UI\'s job via textContent)', () => {
  const hostile = '<img src=x onerror=alert(1)>';
  const { labels } = setup({ live: { mA: fakeModel({ 1: hostile }) }, names: { mA: '<b>Arch</b>' } });
  assert.equal(labels.elementLabel({ modelKey: 'mA', dbId: 1 }), hostile);
  assert.equal(labels.modelName('mA'), '<b>Arch</b>');
});

test('LRU: repeated labels read the tree once; the cache never exceeds LABEL_CACHE_MAX', () => {
  const counter = { reads: 0 };
  const names = new Proxy({}, { get: (_t, k) => `E${String(k)}` });
  const { labels } = setup({ live: { mA: fakeModel(names, counter) } });
  labels.elementLabel({ modelKey: 'mA', dbId: 1 });
  labels.elementLabel({ modelKey: 'mA', dbId: 1 });
  assert.equal(counter.reads, 1);
  for (let dbId = 2; dbId <= LABEL_CACHE_MAX + 1; dbId += 1) labels.elementLabel({ modelKey: 'mA', dbId });
  const before = counter.reads;
  labels.elementLabel({ modelKey: 'mA', dbId: 1 });                         // evicted (least recently used) => re-read
  assert.equal(counter.reads, before + 1);
  labels.elementLabel({ modelKey: 'mA', dbId: LABEL_CACHE_MAX + 1 });       // most recent => still cached
  assert.equal(counter.reads, before + 1);
});

test('a reloaded model (new object, same key) never reuses the old object\'s cached names', () => {
  const { labels, liveModels } = setup({ live: { mA: fakeModel({ 1: 'Old' }) } });
  assert.equal(labels.elementLabel({ modelKey: 'mA', dbId: 1 }), 'Old');
  liveModels.mA = fakeModel({ 1: 'New' });
  assert.equal(labels.elementLabel({ modelKey: 'mA', dbId: 1 }), 'New');
});

test('searchText: model name + dbId always; element name only after warm(); forgetModel drops it', async () => {
  const { labels, scheduler } = setup({ live: { mA: fakeModel({ 1: 'Wall-102' }), mB: fakeModel({ 10: 'Duct-88' }) } });
  const records = [{ resultId: 'r1', pair: { first: { modelKey: 'mA', dbId: 1 }, second: { modelKey: 'mB', dbId: 10 } } }];
  assert.equal(labels.searchText({ modelKey: 'mA', dbId: 1 }), 'architecture  1');
  assert.equal(await drain(scheduler, labels.warm(indexOf(records))), true);
  assert.equal(labels.searchText({ modelKey: 'mA', dbId: 1 }), 'architecture wall-102 1');
  assert.equal(labels.searchText({ modelKey: 'mB', dbId: 10 }), 'structure duct-88 10');
  labels.forgetModel('mB');
  assert.equal(labels.searchText({ modelKey: 'mB', dbId: 10 }), 'structure  10');
  labels.reset();
  assert.equal(labels.searchText({ modelKey: 'mA', dbId: 1 }), 'architecture  1');
});

test('warm() is sliced by LIST_CHUNK_SIZE with one yield per slice, and a superseded pass never commits', async () => {
  const n = LIST_CHUNK_SIZE * 2 + 5;
  const records = Array.from({ length: n }, (_, i) => ({ resultId: `r${i}`, pair: { first: { modelKey: 'mA', dbId: i }, second: { modelKey: 'mA', dbId: i + 1 } } }));
  const { labels, scheduler } = setup({ live: { mA: fakeModel(new Proxy({}, { get: (_t, k) => `N${String(k)}` })) } });
  const before = scheduler.yieldCount;
  assert.equal(await drain(scheduler, labels.warm(indexOf(records))), true);
  assert.equal(scheduler.yieldCount - before, Math.ceil(n / LIST_CHUNK_SIZE));

  let current = true;
  const pending = labels.warm(indexOf(records.map((r) => ({ ...r, pair: { first: { modelKey: 'mA', dbId: r.pair.first.dbId + 100000 }, second: r.pair.second } }))), { isCurrent: () => current });
  current = false;                                   // generation moved on before the first slice ran
  assert.equal(await drain(scheduler, pending), false);
  assert.equal(labels.searchText({ modelKey: 'mA', dbId: 100000 }), 'architecture  100000'); // old index kept, new one never swapped in
  assert.match(labels.searchText({ modelKey: 'mA', dbId: 0 }), /n0/);
});
