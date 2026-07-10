import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshHome } from './helpers.js';

// freshHome() must run before importing modules that read homedir() at load time.
freshHome();

const { parseBlocks } = await import('../src/research/notebook.js');
const { createProject } = await import('../src/workspace/project.js');
const { appendNotebook, readNotebook, searchNotebook, initNotebook } = await import(
  '../src/research/notebook.js'
);

// ── parseBlocks (pure) ──────────────────────────────────────────────────────

test('parseBlocks drops the header preamble and splits entries', () => {
  const md = [
    '# Lab Notebook — Demo',
    '',
    'Auto-kept journal.',
    '',
    '---',
    '',
    '## 2026-07-10 12:00 — 📝 Note',
    '',
    'first note',
    '',
    '---',
    '',
    '## 2026-07-10 12:05 — 💡 Insight',
    '',
    'a realization',
    '',
    '---',
  ].join('\n');
  const blocks = parseBlocks(md);
  assert.equal(blocks.length, 2);
  assert.ok(blocks[0]!.startsWith('## 2026-07-10 12:00 — 📝 Note'));
  assert.ok(blocks[0]!.includes('first note'));
  assert.ok(blocks[1]!.includes('a realization'));
});

test('parseBlocks returns [] when there are no entries', () => {
  assert.deepEqual(parseBlocks('# Header only\n\nsome preamble\n'), []);
});

// ── read/search integration (freshHome) ────────────────────────────────────

test('appendNotebook → readNotebook returns entries newest-first, capped', () => {
  const meta = createProject({ title: 'Notebook Test' });
  initNotebook(meta.slug, meta.title);
  appendNotebook(meta.slug, { type: 'note', summary: 'alpha note' });
  appendNotebook(meta.slug, { type: 'insight', summary: 'beta insight' });
  appendNotebook(meta.slug, { type: 'note', summary: 'gamma note' });

  const recent = readNotebook(meta.slug, { limit: 2 });
  assert.equal(recent.length, 2);
  assert.ok(recent[0]!.includes('gamma note'), 'newest first');
  assert.ok(recent[1]!.includes('beta insight'));
});

test('searchNotebook finds matching entries, case-insensitive, newest-first', () => {
  const meta = createProject({ title: 'Search Test' });
  initNotebook(meta.slug, meta.title);
  appendNotebook(meta.slug, { type: 'note', summary: 'The transformer architecture' });
  appendNotebook(meta.slug, { type: 'note', summary: 'unrelated logging fix' });
  appendNotebook(meta.slug, { type: 'insight', summary: 'Transformer attention is quadratic' });

  const hits = searchNotebook(meta.slug, 'TRANSFORMER');
  assert.equal(hits.length, 2);
  assert.ok(hits[0]!.includes('quadratic'), 'newest match first');
});

test('readNotebook / searchNotebook never throw on a missing project', () => {
  assert.deepEqual(readNotebook('does-not-exist'), []);
  assert.deepEqual(searchNotebook('does-not-exist', 'x'), []);
});

test('searchNotebook with empty term returns []', () => {
  const meta = createProject({ title: 'Empty Term' });
  appendNotebook(meta.slug, { type: 'note', summary: 'something' });
  assert.deepEqual(searchNotebook(meta.slug, '   '), []);
});
