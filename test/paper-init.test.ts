import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { freshHome } from './helpers.js';

freshHome();
const { createProject, projectPaths } = await import('../src/workspace/project.js');
const { initPaper } = await import('../src/workspace/paper.js');

test('initPaper writes main.tex (+ refs.bib) from the blank template', () => {
  const meta = createProject({ title: 'Paper Init' });
  const res = initPaper(meta, 'blank');
  assert.ok(res.ok, res.message);
  const paper = projectPaths(meta.slug).paper;
  assert.ok(existsSync(join(paper, 'main.tex')), 'main.tex created');
  assert.ok(existsSync(join(paper, 'refs.bib')), 'refs.bib seeded');
  // Title flows into the skeleton.
  assert.match(readFileSync(join(paper, 'main.tex'), 'utf-8'), /Paper Init/);
});

test('initPaper refuses to overwrite an existing paper', () => {
  const meta = createProject({ title: 'Init Twice' });
  assert.ok(initPaper(meta, 'blank').ok);
  const again = initPaper(meta, 'blank');
  assert.equal(again.ok, false);
  assert.match(again.message, /already exists/i);
});

test('initPaper reports an unknown template key without writing', () => {
  const meta = createProject({ title: 'Bad Key' });
  const res = initPaper(meta, 'no-such-template');
  assert.equal(res.ok, false);
  assert.match(res.message, /Unknown template/);
  assert.ok(!existsSync(join(projectPaths(meta.slug).paper, 'main.tex')));
});
