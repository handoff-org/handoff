import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'path';
import { mkdtempSync, symlinkSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { freshHome } from './helpers.js';

const home = freshHome();
const { createProject } = await import('../src/workspace/project.js');
const { writeTargetsProject } = await import('../src/agent/approval.js');

const root = join(home, '.handoff', 'projects');

test('relative paths inside the active project are auto-approved', () => {
  createProject({ title: 'Approve Me' }); // active
  assert.equal(writeTargetsProject('{"path":"experiments/run.py"}'), true);
  assert.equal(writeTargetsProject('{"path":"paper/main.tex"}'), true);
});

test('an absolute path inside the project root is approved', () => {
  createProject({ title: 'Abs Test' });
  const inside = join(root, 'abs-test', 'results', 'fig.png');
  assert.equal(writeTargetsProject(JSON.stringify({ path: inside })), true);
});

test('paths escaping the project are not auto-approved', () => {
  createProject({ title: 'Escape Test' });
  assert.equal(writeTargetsProject('{"path":"/etc/passwd"}'), false);
  assert.equal(writeTargetsProject('{"path":"../../secret"}'), false);
});

test('malformed args or missing path return false', () => {
  assert.equal(writeTargetsProject('not json'), false);
  assert.equal(writeTargetsProject('{}'), false);
});

test('a symlinked subdirectory pointing outside the project is NOT auto-approved', () => {
  const meta = createProject({ title: 'Symlink Escape' });
  const outside = mkdtempSync(join(tmpdir(), 'handoff-outside-'));
  mkdirSync(outside, { recursive: true });
  // Create results/ -> <outside> inside the project, then target a path "under" it.
  const linkPath = join(root, meta.slug, 'escape-link');
  symlinkSync(outside, linkPath, 'dir');
  // Lexically this looks inside the project, but it resolves outside → must prompt.
  assert.equal(writeTargetsProject(JSON.stringify({ path: 'escape-link/pwned.txt' })), false);
  // A genuinely in-project path is still auto-approved.
  assert.equal(writeTargetsProject('{"path":"experiments/ok.py"}'), true);
});
