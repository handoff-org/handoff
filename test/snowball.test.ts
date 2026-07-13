import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshHome } from './helpers.js';

const home = freshHome();
const { createProject } = await import('../src/workspace/project.js');
const { snowball } = await import('../src/research/snowball.js');

const proj = createProject({ title: 'Test Snowball Project' });
const slug = proj.slug;

function fakeOAWork(id: string) {
  return {
    id: `https://openalex.org/${id}`,
    title: `Paper ${id}`,
    authorships: [{ author: { display_name: 'Author X' } }],
    publication_year: 2023,
    abstract_inverted_index: null,
    cited_by_count: 10,
    doi: null,
    primary_location: null,
  };
}

function jsonRes(body: unknown, ok = true) {
  const text = JSON.stringify(body);
  return {
    ok,
    status: ok ? 200 : 404,
    json: async () => JSON.parse(text) as unknown,
    headers: { get: () => String(text.length) },
  } as unknown as Response;
}

test('snowball returns empty when openalex returns no works', async (t) => {
  // backward: referenced_works=[], forward: results=[]
  let call = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    call++;
    if (call === 1) return jsonRes({ referenced_works: [] });
    return jsonRes({ results: [] });
  });
  const result = await snowball(slug, 'WSEED', 'both');
  assert.equal(result.paperId, 'WSEED');
  assert.deepEqual(result.papers, []);
});

test('snowball backward finds new papers', async (t) => {
  let call = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    call++;
    if (call === 1) {
      // referenced_works response
      return jsonRes({ referenced_works: ['https://openalex.org/WREF1', 'https://openalex.org/WREF2'] });
    }
    if (call === 2) {
      // batch resolve response
      return jsonRes({ results: [fakeOAWork('WREF1'), fakeOAWork('WREF2')] });
    }
    return jsonRes({ results: [] });
  });
  const result = await snowball(slug, 'WSEED', 'backward');
  assert.equal(result.papers.length, 2);
  assert.ok(result.papers.some((p) => p.id.includes('WREF1')));
  assert.ok(result.papers.some((p) => p.id.includes('WREF2')));
});

test('snowball forward finds new papers', async (t) => {
  t.mock.method(globalThis, 'fetch', async () =>
    jsonRes({ results: [fakeOAWork('WFWD1')] }),
  );
  const result = await snowball(slug, 'WSEED', 'forward');
  assert.equal(result.papers.length, 1);
  assert.ok(result.papers[0]!.id.includes('WFWD1'));
});

test('snowball deduplicates: same paper in both directions counted once', async (t) => {
  let call = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    call++;
    if (call === 1) return jsonRes({ referenced_works: ['https://openalex.org/WSAME'] });
    if (call === 2) return jsonRes({ results: [fakeOAWork('WSAME')] });
    // forward also returns WSAME — should be deduplicated
    return jsonRes({ results: [fakeOAWork('WSAME')] });
  });
  const result = await snowball(slug, 'WSEED', 'both');
  const ids = result.papers.map((p) => p.id);
  const unique = new Set(ids);
  assert.equal(unique.size, ids.length, 'No duplicate papers in result');
  assert.equal(ids.filter((id) => id.includes('WSAME')).length, 1);
});

test('snowball respects limit', async (t) => {
  const many = Array.from({ length: 20 }, (_, i) => fakeOAWork(`WLIM${i}`));
  let call = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    call++;
    if (call === 1) return jsonRes({ referenced_works: many.map((w) => w.id) });
    if (call === 2) return jsonRes({ results: many });
    return jsonRes({ results: [] });
  });
  const result = await snowball(slug, 'WSEED', 'both', 1, 5);
  assert.ok(result.papers.length <= 5, `Expected ≤5 papers, got ${result.papers.length}`);
});
