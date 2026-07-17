import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { freshHome } from './helpers.js';

freshHome();
const { createProject, projectPaths } = await import('../src/workspace/project.js');
const { ToolRegistry } = await import('../src/tools/registry.js');
const { registerWorkspaceTools } = await import('../src/workspace/tools.js');
const { starterBib, blankTemplate } = await import('../src/workspace/templates.js');

function freshRegistry() {
  const reg = new ToolRegistry();
  registerWorkspaceTools(reg);
  return reg;
}

test('the blank template references \\bibliography{refs} (matches refs.bib)', () => {
  assert.match(blankTemplate('X'), /\\bibliography\{refs\}/);
});

test('starterBib is a comment-only BibTeX stub', () => {
  assert.match(starterBib('My Paper'), /% Bibliography for My Paper/);
});

test('start_paper writes main.tex AND refs.bib into paper/, together', async () => {
  const meta = createProject({ title: 'Sync Study' });
  const reg = freshRegistry();
  const out = await reg.call('start_paper', { template: 'blank' });

  const paper = projectPaths(meta.slug).paper;
  const mainPath = join(paper, 'main.tex');
  const bibPath = join(paper, 'refs.bib');

  assert.ok(existsSync(mainPath), 'main.tex missing');
  assert.ok(existsSync(bibPath), 'refs.bib not created next to main.tex');
  // The template must cite the bib that actually exists beside it.
  assert.match(readFileSync(mainPath, 'utf-8'), /\\bibliography\{refs\}/);
  assert.match(out, /refs\.bib/);
});

test('start_paper does not clobber an existing bib', async () => {
  const meta = createProject({ title: 'Has Bib' });
  const paper = projectPaths(meta.slug).paper;
  const { mkdirSync, writeFileSync } = await import('fs');
  mkdirSync(paper, { recursive: true });
  writeFileSync(join(paper, 'mybib.bib'), '@article{keep,title={Keep}}\n', 'utf-8');

  const reg = freshRegistry();
  await reg.call('start_paper', { template: 'blank' });

  // The pre-existing bib is untouched and no second refs.bib is forced in.
  assert.match(readFileSync(join(paper, 'mybib.bib'), 'utf-8'), /keep/);
  assert.ok(!existsSync(join(paper, 'refs.bib')));
});

test('start_paper refuses when main.tex already exists', async () => {
  const meta = createProject({ title: 'Already Started' });
  const paper = projectPaths(meta.slug).paper;
  const { mkdirSync, writeFileSync } = await import('fs');
  mkdirSync(paper, { recursive: true });
  writeFileSync(join(paper, 'main.tex'), '\\documentclass{article}', 'utf-8');

  const reg = freshRegistry();
  const out = await reg.call('start_paper', { template: 'blank' });
  assert.match(out, /already exists/);
});

test('start_paper copies a template folder verbatim, skips dotdirs, substitutes the title', async () => {
  const meta = createProject({ title: 'Copy Me' });
  const paper = projectPaths(meta.slug).paper;

  // Author a template under ~/.handoff/templates/<key>/ (as a user would).
  const { TEMPLATES_DIR } = await import('../src/workspace/templateStore.js');
  const { mkdirSync, writeFileSync } = await import('fs');
  const tdir = join(TEMPLATES_DIR, 'mytpl');
  mkdirSync(join(tdir, '.github'), { recursive: true });
  writeFileSync(
    join(tdir, 'main.tex'),
    '\\documentclass{article}\n\\title{TITLE_GOES_HERE}\n\\begin{document}\n\\bibliography{custom}\n\\end{document}\n',
    'utf-8',
  );
  writeFileSync(join(tdir, 'venue.sty'), '% style file\n', 'utf-8');
  writeFileSync(join(tdir, 'custom.bib'), '@article{keep,title={Keep}}\n', 'utf-8');
  writeFileSync(join(tdir, '.github', 'ci.yml'), 'noop\n', 'utf-8');

  const reg = freshRegistry();
  const out = await reg.call('start_paper', { template: 'mytpl' });

  // Every render material comes along; CI dotdir is skipped.
  assert.ok(existsSync(join(paper, 'venue.sty')), 'style file not copied');
  assert.ok(existsSync(join(paper, 'custom.bib')), 'template bib not copied');
  assert.ok(!existsSync(join(paper, '.github')), '.github should be skipped');

  // The title token is replaced with the project title.
  const main = readFileSync(join(paper, 'main.tex'), 'utf-8');
  assert.match(main, /\\title\{Copy Me\}/);
  assert.doesNotMatch(main, /TITLE_GOES_HERE/);

  // The template ships its own custom.bib, so no refs.bib is forced in.
  assert.ok(!existsSync(join(paper, 'refs.bib')), 'refs.bib should not be added');
  assert.match(out, /Mytpl/);
});
