import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshHome } from './helpers.js';

freshHome();

const { weaselHits, passiveHits, dupWordHits, labelsIn, refsIn, citeKeysIn, scaffoldSections } =
  await import('../src/research/prose.js');
const { checkProse } = await import('../src/research/prose.js');
const { createProject } = await import('../src/workspace/project.js');
const { writeFileSync, mkdirSync } = await import('fs');
const { join } = await import('path');
const { projectDir } = await import('../src/workspace/project.js');

// ── Pure detectors ──────────────────────────────────────────────────────────

test('weaselHits finds hedge words including multi-word phrases', () => {
  assert.deepEqual(weaselHits('This is very clearly a number of things').sort(), [
    'a number of',
    'clearly',
    'very',
  ]);
  assert.deepEqual(weaselHits('A precise, quantified statement.'), []);
});

test('passiveHits flags be + participle', () => {
  assert.ok(passiveHits('The model was trained on ImageNet.').length === 1);
  assert.ok(passiveHits('results are shown in Table 1').length === 1);
  assert.deepEqual(passiveHits('We train the model.'), []);
});

test('dupWordHits catches doubled words', () => {
  assert.deepEqual(dupWordHits('the the model'), ['the']);
  assert.deepEqual(dupWordHits('a clean sentence'), []);
});

test('labelsIn / refsIn / citeKeysIn extract keys (comma lists expanded)', () => {
  assert.deepEqual(labelsIn('\\label{sec:intro} text \\label{fig:1}'), ['sec:intro', 'fig:1']);
  assert.deepEqual(refsIn('see \\ref{sec:intro} and \\autoref{fig:1}'), ['sec:intro', 'fig:1']);
  assert.deepEqual(citeKeysIn('\\citep[e.g.][]{a2020,b2021} \\cite{c2022}'), [
    'a2020',
    'b2021',
    'c2022',
  ]);
});

test('scaffoldSections returns labelled sections', () => {
  const s = scaffoldSections('default');
  assert.ok(s.includes('\\section{Introduction}'));
  assert.ok(s.includes('\\label{sec:related-work}'));
  assert.ok(scaffoldSections('empirical').includes('Experimental Setup'));
});

// ── checkProse integration (freshHome) ──────────────────────────────────────

function writePaper(slug: string, files: Record<string, string>) {
  const paperDir = join(projectDir(slug), 'paper');
  mkdirSync(paperDir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(paperDir, name), content, 'utf-8');
  }
}

test('checkProse flags dangling refs, missing cites, weasel words, and TODOs', () => {
  const meta = createProject({ title: 'Prose Test' });
  writePaper(meta.slug, {
    'main.tex':
      '\\section{Intro}\\label{sec:intro}\n' +
      'This is very good and was evaluated \\cite{known2020}.\n' +
      'See \\ref{sec:missing} for details. % TODO tighten this\n' +
      'Results \\cite{ghost2021} confirm it.\n',
    'refs.bib': '@article{known2020, title={X}, author={Y}, year={2020}}\n',
  });

  const report = checkProse(meta.slug);
  const kinds = report.issues.map((i) => i.kind);

  assert.ok(kinds.includes('dangling-ref'), 'sec:missing has no label');
  assert.ok(kinds.includes('missing-cite'), 'ghost2021 not in refs.bib');
  assert.ok(
    !report.issues.some((i) => i.kind === 'missing-cite' && i.message.includes('known2020')),
  );
  assert.ok(kinds.includes('weasel'), '"very" flagged');
  assert.ok(kinds.includes('todo'), 'TODO flagged');
  assert.ok(report.bibFound);
});

test('checkProse on a clean paper reports no issues', () => {
  const meta = createProject({ title: 'Clean Paper' });
  writePaper(meta.slug, {
    'main.tex': '\\section{Intro}\\label{sec:intro}\nWe present a method. See \\ref{sec:intro}.\n',
    'refs.bib': '',
  });
  const report = checkProse(meta.slug);
  assert.equal(report.issues.filter((i) => i.severity === 'warn').length, 0);
});

test('checkProse handles a project with no paper dir', () => {
  const meta = createProject({ title: 'No Paper Yet' });
  const report = checkProse(meta.slug);
  assert.equal(report.filesScanned, 0);
});
