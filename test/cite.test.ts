import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { freshHome } from './helpers.js';

// Isolate HOME before importing anything that reads homedir() at load.
freshHome();
const { ToolRegistry } = await import('../src/tools/registry.js');
const { registerResearchTools } = await import('../src/research/tools.js');
const { createProject } = await import('../src/workspace/project.js');
const { initPaper } = await import('../src/workspace/paper.js');
const { projectPaths } = await import('../src/workspace/project.js');

const reg = new ToolRegistry();
registerResearchTools(reg);

/** Write a paper into the local research cache so cite_paper resolves offline. */
function cachePaperJson(id: string, body: Record<string, unknown>): void {
  const dir = join(homedir(), '.handoff', 'research', 'papers');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${id}.json`),
    JSON.stringify({
      id,
      title: 'Attention Is All You Need',
      year: 2017,
      venue: 'NeurIPS',
      citations: 100,
      doi: '10.5555/attn',
      oaUrl: '',
      authors: ['Ashish Vaswani', 'Noam Shazeer'],
      abstract: 'The dominant sequence transduction models…',
      ...body,
    }),
    'utf-8',
  );
}

test('cite_paper is gated as a sensitive (mutating) tool', () => {
  assert.equal(reg.isSensitive('cite_paper'), true);
});

test('cite_paper refuses when the project has no paper yet', async () => {
  createProject({ title: 'No Paper' });
  const out = await reg.call('cite_paper', { id: 'W1' });
  assert.match(out, /start_paper/);
});

test('cite_paper adds a BibTeX entry and returns the \\cite{} command', async () => {
  const meta = createProject({ title: 'Cite Demo' });
  initPaper(meta, 'blank');
  cachePaperJson('W1');

  const out = await reg.call('cite_paper', { id: 'W1' });
  assert.match(out, /\\cite\{vaswani2017attention\}/);

  const bib = readFileSync(join(projectPaths(meta.slug).paper, 'refs.bib'), 'utf-8');
  assert.match(bib, /@article\{vaswani2017attention,/);
  assert.match(bib, /title = \{\{Attention Is All You Need\}\}/);
  assert.match(bib, /doi = \{10\.5555\/attn\}/);
});

test('cite_paper is idempotent — citing the same paper twice makes no duplicate', async () => {
  const meta = createProject({ title: 'Idempotent Cite' });
  initPaper(meta, 'blank');
  cachePaperJson('W1');

  await reg.call('cite_paper', { id: 'W1' });
  const second = await reg.call('cite_paper', { id: 'W1' });
  assert.match(second, /Already in/);

  const bib = readFileSync(join(projectPaths(meta.slug).paper, 'refs.bib'), 'utf-8');
  const count = (bib.match(/@article\{vaswani2017attention,/g) ?? []).length;
  assert.equal(count, 1, 'the entry must appear exactly once');
});

test('cite_paper disambiguates a colliding key for a different paper', async () => {
  const meta = createProject({ title: 'Collision Cite' });
  initPaper(meta, 'blank');
  // Same author family + year + first title word → same base key, different paper.
  cachePaperJson('W1');
  cachePaperJson('W2', { doi: '10.5555/other', title: 'Attention Attention Everywhere' });

  await reg.call('cite_paper', { id: 'W1' });
  const out = await reg.call('cite_paper', { id: 'W2' });
  assert.match(out, /\\cite\{vaswani2017attentiona\}/);

  const bib = readFileSync(join(projectPaths(meta.slug).paper, 'refs.bib'), 'utf-8');
  assert.match(bib, /@article\{vaswani2017attention,/);
  assert.match(bib, /@article\{vaswani2017attentiona,/);
});
