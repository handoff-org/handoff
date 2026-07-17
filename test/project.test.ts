import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'fs';
import { join, isAbsolute } from 'path';
import { freshHome } from './helpers.js';

// Isolate HOME before importing — PROJECTS_DIR is fixed at module load.
const home = freshHome();
const {
  createProject,
  loadProject,
  listProjects,
  deleteProject,
  getActiveProject,
  resolveWorkspacePath,
  slugify,
  WORKSPACE_SUBDIRS,
} = await import('../src/workspace/project.js');

const root = join(home, '.handoff', 'projects');

test('slugify normalizes a title', () => {
  assert.equal(slugify('My Great Paper!'), 'my-great-paper');
});

test('createProject scaffolds all subdirs, leaves paper/ empty, and sets it active', () => {
  const meta = createProject({ title: 'Alpha Study' });
  assert.equal(meta.slug, 'alpha-study');
  for (const sub of WORKSPACE_SUBDIRS) {
    assert.ok(existsSync(join(root, 'alpha-study', sub)), `missing ${sub}/`);
  }
  // The bib is NOT scaffolded into literature/ — it belongs next to the paper
  // (paper/refs.bib, created by start_paper). paper/ must start empty so that
  // linking an Overleaf project (which clones into paper/) still works.
  assert.ok(!existsSync(join(root, 'alpha-study', 'literature', 'refs.bib')));
  assert.equal(readdirSync(join(root, 'alpha-study', 'paper')).length, 0);
  assert.equal(getActiveProject()?.slug, 'alpha-study');
});

test('createProject rejects a duplicate slug', () => {
  assert.throws(() => createProject({ title: 'Alpha Study' }), /already exists/);
});

test('loadProject and listProjects round-trip', () => {
  createProject({ title: 'Beta Study' });
  assert.equal(loadProject('beta-study')?.title, 'Beta Study');
  const slugs = listProjects().map((p) => p.slug);
  assert.ok(slugs.includes('alpha-study'));
  assert.ok(slugs.includes('beta-study'));
});

test('resolveWorkspacePath joins relative paths to the active project root', () => {
  createProject({ title: 'Gamma' }); // becomes active
  const resolved = resolveWorkspacePath('paper/refs.bib');
  assert.equal(resolved, join(root, 'gamma', 'paper', 'refs.bib'));
});

test('resolveWorkspacePath leaves absolute paths untouched', () => {
  assert.equal(resolveWorkspacePath('/etc/hosts'), '/etc/hosts');
  assert.ok(isAbsolute(resolveWorkspacePath('relative')));
});

test('deleteProject removes files and clears the active pointer when it was active', () => {
  createProject({ title: 'Doomed' }); // active
  assert.equal(getActiveProject()?.slug, 'doomed');
  deleteProject('doomed');
  assert.ok(!existsSync(join(root, 'doomed')));
  assert.equal(getActiveProject(), null);
});

test('deleteProject throws for an unknown slug', () => {
  assert.throws(() => deleteProject('nope'), /No project/);
});
