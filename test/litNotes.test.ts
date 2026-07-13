import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshHome } from './helpers.js';

const home = freshHome();
const { createProject } = await import('../src/workspace/project.js');
const { readLitNotes, writeLitNote, searchLitNotes, litNotesPath } = await import(
  '../src/research/litNotes.js'
);

const proj = createProject({ title: 'Test Lit Project' });
const slug = proj.slug;

function makeNote(paperId: string, overrides: Partial<Parameters<typeof writeLitNote>[1]> = {}) {
  return {
    paperId,
    title: `Paper ${paperId}`,
    authors: ['Author A'],
    year: 2024,
    keyPassages: [{ quote: 'Key insight here', comment: 'very relevant' }],
    relevanceSummary: 'relevant to methodology',
    tags: ['method'],
    status: 'read' as const,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

test('readLitNotes returns empty array when no file', () => {
  assert.deepEqual(readLitNotes('no-such-slug'), []);
});

test('writeLitNote appends new note', () => {
  writeLitNote(slug, makeNote('W001'));
  const notes = readLitNotes(slug);
  assert.equal(notes.length, 1);
  assert.equal(notes[0]!.paperId, 'W001');
});

test('writeLitNote upserts by paperId', () => {
  writeLitNote(slug, makeNote('W001', { relevanceSummary: 'updated summary' }));
  const notes = readLitNotes(slug);
  assert.equal(notes.length, 1);
  assert.equal(notes[0]!.relevanceSummary, 'updated summary');
});

test('writeLitNote appends different paper', () => {
  writeLitNote(slug, makeNote('W002'));
  const notes = readLitNotes(slug);
  assert.equal(notes.length, 2);
});

test('searchLitNotes finds by title substring', () => {
  writeLitNote(slug, makeNote('W003', { title: 'Attention is All You Need' }));
  const results = searchLitNotes(slug, 'attention');
  assert.ok(results.some((n) => n.paperId === 'W003'));
});

test('searchLitNotes finds by tag', () => {
  writeLitNote(slug, makeNote('W004', { tags: ['transformer', 'nlp'] }));
  const results = searchLitNotes(slug, 'transformer');
  assert.ok(results.some((n) => n.paperId === 'W004'));
});

test('searchLitNotes finds by key passage text', () => {
  writeLitNote(slug, makeNote('W005', { keyPassages: [{ quote: 'self-attention mechanism improves performance' }] }));
  const results = searchLitNotes(slug, 'self-attention');
  assert.ok(results.some((n) => n.paperId === 'W005'));
});

test('searchLitNotes is case-insensitive', () => {
  const results = searchLitNotes(slug, 'ATTENTION');
  assert.ok(results.some((n) => n.paperId === 'W003'));
});

test('searchLitNotes returns empty for no match', () => {
  const results = searchLitNotes(slug, 'xyzzy_no_match_123');
  assert.equal(results.length, 0);
});
