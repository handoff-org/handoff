import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, writeFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { spawnSync } from 'child_process';
import { freshHome, makeBareRemote, git, hasGit } from './helpers.js';

const home = freshHome();
const { createProject, updateProject, projectPaths } = await import('../src/workspace/project.js');
const { bibFileIn, overleafWriteGuard, isOverleafLinked, autoSyncOverleaf, autoPullOverleaf } =
  await import('../src/workspace/overleaf.js');

const gitAvailable = hasGit();

/**
 * Turn an existing project's paper/ into a git repo tracking `remote`/main,
 * mimicking what `linkOverleaf` produces — without touching the network. An
 * explicit `push -u` establishes upstream so later push/pull just work.
 */
function linkPaperTo(slug: string, remote: string): string {
  const paper = projectPaths(slug).paper;
  git(paper, 'init');
  git(paper, 'branch', '-M', 'main');
  writeFileSync(
    join(paper, 'main.tex'),
    '\\documentclass{article}\\begin{document}hi\\end{document}',
  );
  git(paper, 'add', '-A');
  git(paper, 'commit', '-m', 'init');
  git(paper, 'remote', 'add', 'origin', remote);
  git(paper, 'push', '-u', 'origin', 'main');
  return paper;
}

test('bibFileIn finds a .bib, or returns null when there is none', () => {
  const meta = createProject({ title: 'Bib Find' });
  const paper = projectPaths(meta.slug).paper;
  assert.equal(bibFileIn(paper), null);
  writeFileSync(join(paper, 'references.bib'), '% bib\n');
  assert.equal(bibFileIn(paper), join(paper, 'references.bib'));
});

test('write guard redirects a .bib written outside paper/ (the sync bug)', () => {
  const meta = createProject({ title: 'Guard Test' });
  updateProject(meta.slug, { paperMode: 'overleaf' });
  const paper = projectPaths(meta.slug).paper;
  // Guard only engages once paper/ is a real git clone.
  git(paper, 'init');

  const stray = join(projectPaths(meta.slug).literature, 'refs.bib');
  const msg = overleafWriteGuard(stray, '@article{x}');
  assert.ok(msg, 'expected the guard to block a .bib outside paper/');
  assert.match(msg!, /outside the Overleaf-synced paper folder/);

  // A .bib written inside paper/ is allowed through.
  assert.equal(overleafWriteGuard(join(paper, 'references.bib'), '@article{x}'), null);
});

test(
  'autoSync pushes local paper edits and autoPull brings down remote edits',
  { skip: !gitAvailable },
  () => {
    const remote = makeBareRemote();
    const meta = createProject({ title: 'Round Trip' });
    updateProject(meta.slug, { paperMode: 'overleaf' });
    const paper = linkPaperTo(meta.slug, remote);

    assert.equal(isOverleafLinked(), true);

    // Local edit → autoSync should commit + push and name the file.
    writeFileSync(join(paper, 'references.bib'), '@article{key, title={T}}\n');
    const sync = autoSyncOverleaf();
    assert.ok(sync, 'expected a sync note');
    assert.match(sync!, /synced to Overleaf/);
    assert.match(sync!, /references\.bib/);

    // A separate clone simulates an Overleaf web edit pushed by someone else.
    const other = mkdtempSync(join(tmpdir(), 'handoff-other-'));
    spawnSync('git', ['clone', remote, other]);
    assert.ok(existsSync(join(other, 'references.bib')), 'push did not reach the remote');
    writeFileSync(join(other, 'web-edit.tex'), 'from the web');
    git(other, 'add', '-A');
    git(other, 'commit', '-m', 'web edit');
    git(other, 'push');

    // autoPull should fast-forward the remote change into paper/.
    const pulled = autoPullOverleaf();
    assert.ok(pulled, 'expected a pulled note');
    assert.match(pulled!, /pulled the latest/i);
    assert.ok(existsSync(join(paper, 'web-edit.tex')), 'pull did not land the web edit');
  },
);

test('autoSync is a no-op (null) when nothing changed', { skip: !gitAvailable }, () => {
  const remote = makeBareRemote();
  const meta = createProject({ title: 'Quiet' });
  updateProject(meta.slug, { paperMode: 'overleaf' });
  linkPaperTo(meta.slug, remote);
  assert.equal(autoSyncOverleaf(), null);
});
