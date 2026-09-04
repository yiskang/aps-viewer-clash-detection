import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractFragments, ExtractionLimitExceededError } from '../../collision/viewer/ViewerModelAdapter.js';
import { maxChildrenPerNode, maxFragmentsPerDbId } from '../../collision/constants.js';
import { buildMockModel } from '../fixtures/mockInstanceTree.mjs';

const LOAD_EPOCH = 7;

test('single node with direct fragments -- basic extraction', async () => {
  const { model } = buildMockModel(
    [{ dbId: 1, fragments: [101, 102] }],
    new Map([
      [101, { geometryIndex: 5 }],
      [102, { geometryIndex: 6 }],
    ]),
  );
  const result = await extractFragments(model, [1], LOAD_EPOCH);
  assert.equal(result.size, 2);
  assert.equal(result.get(101).ownerDbId, 1);
  assert.equal(result.get(101).geometryIdentity.loadEpoch, LOAD_EPOCH);
  assert.equal(result.get(101).geometryIdentity.geometryIndex, 5);
  assert.equal(result.get(101).worldMatrix.length, 16);
  assert.deepEqual(result.get(101).worldBounds, { min: [0, 0, 0], max: [1, 1, 1] });
});

test('multiple requested root dbIds are all walked', async () => {
  const { model } = buildMockModel(
    [
      { dbId: 1, fragments: [101] },
      { dbId: 2, fragments: [201] },
    ],
    new Map([[101, { geometryIndex: 1 }], [201, { geometryIndex: 2 }]]),
  );
  const result = await extractFragments(model, [1, 2], LOAD_EPOCH);
  assert.equal(result.size, 2);
  assert.equal(result.get(101).ownerDbId, 1);
  assert.equal(result.get(201).ownerDbId, 2);
});

test('family node with no direct fragments descends into child (round-18 acceptance-model shape)', async () => {
  // Mirrors dbId 2527 (family, no own fragments) / 2530 (child instance, owns fragments) —
  // spec:1095-1111. A non-recursive call on the ancestor alone must NOT silently report empty.
  const { model } = buildMockModel(
    [{ dbId: 2527, fragments: [], children: [{ dbId: 2530, fragments: [42] }] }],
    new Map([[42, { geometryIndex: 9 }]]),
  );
  const result = await extractFragments(model, [2527], LOAD_EPOCH);
  assert.equal(result.size, 1);
  assert.equal(result.get(42).ownerDbId, 2530, 'ownerDbId must name the child instance node, never the requested ancestor');
});

test('round-18 coverage-equivalence: self-driven walk === one recursive enumNodeFragments call, as sets', async () => {
  // Richer tree: family node 2527 with child 2530 (fragments), a sibling branch 2531 that
  // redundantly reports the SAME fragment id (double-report case spec:1298-1310), and an
  // unrelated cousin subtree to make the comparison non-trivial.
  const tree = [{
    dbId: 2527,
    fragments: [],
    children: [
      { dbId: 2530, fragments: [42, 43] },
      { dbId: 2531, fragments: [43, 44] },          // 43 double-reported under a second node
      { dbId: 2532, fragments: [], children: [{ dbId: 2533, fragments: [45] }] },
    ],
  }];
  const geometry = new Map([42, 43, 44, 45].map((id) => [id, { geometryIndex: id }]));
  const { model } = buildMockModel(tree, geometry);

  const selfDriven = await extractFragments(model, [2527], LOAD_EPOCH);

  const groundTruth = new Set();
  model.getInstanceTree().enumNodeFragments(2527, (fragId) => groundTruth.add(fragId), true);

  assert.deepEqual(new Set(selfDriven.keys()), groundTruth, 'unique fragment-id sets must match exactly');
  assert.equal(selfDriven.size, groundTruth.size, 'exactly one output entry per unique fragment id');
  // first-discovery-wins: 43 first reported under 2530 (visited before 2531 in child order)
  assert.equal(selfDriven.get(43).ownerDbId, 2530);
});

test('ownerDbId provenance: fragment reported under two of the call\'s own requested dbIds -- first discovery wins', async () => {
  const tree = [
    { dbId: 10, fragments: [999] },
    { dbId: 20, fragments: [999] },
  ];
  const { model } = buildMockModel(tree, new Map([[999, { geometryIndex: 1 }]]));
  const result = await extractFragments(model, [10, 20], LOAD_EPOCH);
  assert.equal(result.size, 1);
  assert.equal(result.get(999).ownerDbId, 10, 'must keep the FIRST requested dbId\'s node, never overwrite on rediscovery under dbId 20');
});

test('a node whose first child dbId is 0 is walked normally -- not mistaken for an abort signal', async () => {
  const tree = [{
    dbId: 1,
    fragments: [],
    children: [
      { dbId: 0, fragments: [501] },
      { dbId: 2, fragments: [502] },
    ],
  }];
  const geometry = new Map([[501, { geometryIndex: 1 }], [502, { geometryIndex: 2 }]]);
  const { model } = buildMockModel(tree, geometry);
  const result = await extractFragments(model, [1], LOAD_EPOCH);
  assert.equal(result.size, 2, 'both children (including dbId 0) must be visited');
  assert.equal(result.get(501).ownerDbId, 0);
  assert.equal(result.get(502).ownerDbId, 2);
});

test('fanout ceiling: node with maxChildrenPerNode + 1 children, fragment-free -- rejects, exactly maxChildrenPerNode + 1 callbacks, getChildCount never called', async () => {
  const children = [];
  for (let i = 0; i < maxChildrenPerNode + 1; i++) children.push({ dbId: 1000 + i, fragments: [] });
  const { model, stats } = buildMockModel([{ dbId: 1, fragments: [], children }], new Map());

  await assert.rejects(
    () => extractFragments(model, [1], LOAD_EPOCH),
    (err) => {
      assert.ok(err instanceof ExtractionLimitExceededError);
      assert.equal(err.limit, 'maxChildrenPerNode');
      assert.equal(err.requestedDbId, 1);
      assert.equal(err.node, 1);
      return true;
    },
  );
  assert.equal(stats.enumNodeChildrenCallbacks, maxChildrenPerNode + 1, 'must cost exactly maxChildrenPerNode + 1 callbacks, never more');
  assert.equal(stats.getChildCountCalls, 0, 'getChildCount must never be called (invariant-audit finding C-1)');
});

test('fanout ceiling: node with maxChildrenPerNode + 1 children, MIXED with own fragments -- same bound', async () => {
  const children = [];
  for (let i = 0; i < maxChildrenPerNode + 1; i++) children.push({ dbId: 2000 + i, fragments: [] });
  const { model, stats } = buildMockModel(
    [{ dbId: 1, fragments: [777], children }],
    new Map([[777, { geometryIndex: 1 }]]),
  );
  await assert.rejects(() => extractFragments(model, [1], LOAD_EPOCH), ExtractionLimitExceededError);
  assert.equal(stats.enumNodeChildrenCallbacks, maxChildrenPerNode + 1);
  assert.equal(stats.getChildCountCalls, 0);
});

test('fanout ceiling companion: exactly maxChildrenPerNode children -- no abort, walk completes normally', async () => {
  const children = [];
  for (let i = 0; i < maxChildrenPerNode; i++) children.push({ dbId: 3000 + i, fragments: [] });
  const { model, stats } = buildMockModel([{ dbId: 1, fragments: [], children }], new Map());
  const result = await extractFragments(model, [1], LOAD_EPOCH);
  assert.equal(result.size, 0); // no fragments anywhere, but no rejection either
  assert.equal(stats.enumNodeChildrenCallbacks, maxChildrenPerNode, 'all maxChildrenPerNode invocations must run, not maxChildrenPerNode + 1');
});

test('fanout ceiling companion, MIXED: exactly maxChildrenPerNode children plus fragments at several nodes', async () => {
  const children = [];
  for (let i = 0; i < maxChildrenPerNode; i++) {
    children.push({ dbId: 4000 + i, fragments: i % 500 === 0 ? [9000 + i] : [] });
  }
  const { model, stats } = buildMockModel([{ dbId: 1, fragments: [], children }], new Map(
    children.filter((c) => c.fragments.length).map((c) => [c.fragments[0], { geometryIndex: c.dbId }]),
  ));
  const result = await extractFragments(model, [1], LOAD_EPOCH);
  assert.equal(result.size, 20); // maxChildrenPerNode / 500 = 20 nodes contributed one fragment each
  assert.equal(stats.enumNodeChildrenCallbacks, maxChildrenPerNode);
});

test('single node exceeding maxFragmentsPerDbId directly -- rejects naming the dbId', async () => {
  const fragments = Array.from({ length: maxFragmentsPerDbId + 1 }, (_, i) => 8000 + i);
  const geometry = new Map(fragments.map((id) => [id, { geometryIndex: id }]));
  const { model } = buildMockModel([{ dbId: 1, fragments }], geometry);
  await assert.rejects(
    () => extractFragments(model, [1], LOAD_EPOCH),
    (err) => {
      assert.ok(err instanceof ExtractionLimitExceededError);
      assert.equal(err.limit, 'maxFragmentsPerDbId');
      assert.equal(err.requestedDbId, 1);
      return true;
    },
  );
});

test('round-16 regression: oversized subtree crosses maxFragmentsPerDbId by visit 10, not visit 100', async () => {
  // 100 sibling nodes under one root, 501 fragments each. Cumulative tally exceeds 5000 at the 10th
  // node visited (9 * 501 = 4509, 10 * 501 = 5010 > 5000). Walk must stop there, never touching
  // nodes 11-100. spec:2931-2960 (accepted non-preemptible risk), fixture per Extract D section 2.
  const children = [];
  for (let i = 0; i < 100; i++) {
    const frags = Array.from({ length: 501 }, (_, j) => i * 1000 + j);
    children.push({ dbId: 100 + i, fragments: frags });
  }
  const geometry = new Map();
  for (const child of children) for (const f of child.fragments) geometry.set(f, { geometryIndex: f });
  const { model, stats } = buildMockModel([{ dbId: 1, fragments: [], children }], geometry);

  await assert.rejects(
    () => extractFragments(model, [1], LOAD_EPOCH),
    (err) => {
      assert.equal(err.limit, 'maxFragmentsPerDbId');
      assert.equal(err.requestedDbId, 1);
      return true;
    },
  );
  assert.ok(stats.enumNodeFragmentsCalls <= 11, `expected ~10-11 enumNodeFragments calls, got ${stats.enumNodeFragmentsCalls}`);
  assert.ok(stats.enumNodeChildrenCalls <= 11, `expected ~10-11 enumNodeChildren calls, got ${stats.enumNodeChildrenCalls}`);
});

test('per-requested-dbId tally is independent: first dbId under limit, second dbId over -- rejection names the SECOND', async () => {
  const okFrags = [1, 2, 3];
  const overFrags = Array.from({ length: maxFragmentsPerDbId + 1 }, (_, i) => 9000 + i);
  const geometry = new Map();
  for (const f of [...okFrags, ...overFrags]) geometry.set(f, { geometryIndex: f });
  const { model } = buildMockModel(
    [{ dbId: 1, fragments: okFrags }, { dbId: 2, fragments: overFrags }],
    geometry,
  );
  await assert.rejects(
    () => extractFragments(model, [1, 2], LOAD_EPOCH),
    (err) => {
      assert.equal(err.limit, 'maxFragmentsPerDbId');
      assert.equal(err.requestedDbId, 2);
      return true;
    },
  );
});

test('checkpoint fires between every node visit on a deep single-child chain, not only at true siblings', async () => {
  // A chain of 6 nodes, each with exactly one child, has no literal siblings anywhere -- if the
  // checkpoint were only wired to fire "between siblings" it would never fire at all here, letting
  // an arbitrarily deep chain run unyielded. Codex-advisor review flagged this distinction explicitly.
  let node = { dbId: 6, fragments: [] };
  for (let i = 5; i >= 1; i--) node = { dbId: i, fragments: [], children: [node] };
  const { model } = buildMockModel([node], new Map());
  const visits = [];
  await extractFragments(model, [1], LOAD_EPOCH, {
    checkpoint: async (ctx) => { visits.push(ctx.requestedDbId); },
  });
  assert.ok(visits.length >= 5, `expected a checkpoint between each of the 6 chained node visits, got ${visits.length}`);
});

test('optional checkpoint hook is awaited before each requested dbId and between sibling visits', async () => {
  const calls = [];
  const { model } = buildMockModel(
    [
      { dbId: 1, fragments: [], children: [{ dbId: 11, fragments: [] }, { dbId: 12, fragments: [] }] },
      { dbId: 2, fragments: [] },
    ],
    new Map(),
  );
  await extractFragments(model, [1, 2], LOAD_EPOCH, {
    checkpoint: async (ctx) => { calls.push(ctx.requestedDbId); },
  });
  assert.ok(calls.length >= 2, 'must checkpoint at least once per requested dbId');
  assert.deepEqual(calls.filter((v, i) => calls.indexOf(v) === i).sort(), [1, 2]);
});

test('checkpoint rejection propagates and aborts the walk (used by callers to surface WorldDisposedError/ModelEvictedError mid-extraction)', async () => {
  const { model } = buildMockModel(
    [{ dbId: 1, fragments: [], children: [{ dbId: 11, fragments: [1] }, { dbId: 12, fragments: [2] }] }],
    new Map([[1, { geometryIndex: 1 }], [2, { geometryIndex: 2 }]]),
  );
  class FakeDisposedError extends Error {}
  let calls = 0;
  await assert.rejects(
    () => extractFragments(model, [1], LOAD_EPOCH, {
      checkpoint: async () => { calls++; if (calls === 2) throw new FakeDisposedError(); },
    }),
    FakeDisposedError,
  );
});
