import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { freshHome } from './helpers.js';

freshHome();
const { createProject, updateProject, projectPaths } = await import('../src/workspace/project.js');
const { buildSystem, projectContext, starterTex } = await import('../src/agent/systemPrompt.js');

test('no project → no project context', () => {
  assert.equal(projectContext(null), '');
});

test('buildSystem always appends the interaction + write directives', () => {
  const sys = buildSystem('BASE', null);
  assert.match(sys, /^BASE/);
  assert.match(sys, /ask_user/);
  assert.match(sys, /write_file/);
});

test('buildSystem is deterministic for identical inputs (cache-friendly prefix)', () => {
  // The compaction layer keeps messages[0] verbatim so backends can prefix-cache
  // it; that only pays off if buildSystem itself is stable turn-to-turn.
  const a = buildSystem('BASE', null);
  const b = buildSystem('BASE', null);
  assert.equal(a, b);
});

test('local project keeps the bibliography in paper/, alongside main.tex', () => {
  const meta = createProject({ title: 'Local Paper' });
  const ctx = projectContext(meta);
  const paper = projectPaths(meta.slug).paper;
  // The bib lives next to the paper in paper/, not split off into literature/.
  assert.match(ctx, new RegExp(paper.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(ctx, /refs\.bib/);
  assert.match(ctx, /never in[\s\S]*literature/i);
  assert.ok(!/auto-syncs to Overleaf/.test(ctx));
});

test('overleaf project keeps the bib inside paper/, never literature/', () => {
  const meta = createProject({ title: 'Synced Paper' });
  updateProject(meta.slug, { paperMode: 'overleaf' });
  const paper = projectPaths(meta.slug).paper;
  // Give it a real main file + bib so the guidance references concrete paths.
  writeFileSync(
    join(paper, 'main.tex'),
    '\\documentclass{article}\\begin{document}\\end{document}',
  );
  writeFileSync(join(paper, 'references.bib'), '% bib\n');

  const ctx = projectContext({ ...meta, paperMode: 'overleaf' });
  assert.match(ctx, /auto-syncs to Overleaf/);
  // The bug we fixed: references must live in paper/, explicitly NOT literature/.
  assert.match(ctx, /NOT in literature/);
  assert.match(ctx, new RegExp(paper.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  // An existing paper must still be told to carry a \bibliographystyle.
  assert.match(ctx, /\\bibliographystyle\{plainnat\}/);
});

test('a fresh overleaf paper directs the agent to use start_paper', () => {
  const meta = createProject({ title: 'Brand New' });
  updateProject(meta.slug, { paperMode: 'overleaf' });
  // No main.tex on disk → guidance should use start_paper, not inline skeleton.
  const ctx = projectContext({ ...meta, paperMode: 'overleaf' });
  assert.match(ctx, /start_paper/);
  assert.match(ctx, /ask_user/);
  // Should NOT embed an inline LaTeX skeleton any more.
  assert.doesNotMatch(ctx, /\\documentclass\{article\}/);
});

test('starterTex emits both bibliography lines for any bib name', () => {
  const tex = starterTex('My Title', 'mybib');
  assert.match(tex, /\\bibliographystyle\{plainnat\}/);
  assert.match(tex, /\\bibliography\{mybib\}/);
  assert.match(tex, /\\begin\{document\}[\s\S]*\\end\{document\}/);
});
