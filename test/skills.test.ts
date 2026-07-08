import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { freshHome } from './helpers.js';

const home = freshHome();
const { loadSkills, findSkill } = await import('../src/skills/store.js');

const SKILLS_DIR = join(homedir(), '.handoff', 'skills');

test('built-in folder skills load (skills/<name>/<name>.md)', () => {
  const names = loadSkills()
    .map((s) => s.name)
    .sort();
  // The three built-in skills shipped in the repo's skills/ directory.
  assert.ok(names.includes('overleaf'), 'overleaf not loaded');
  assert.ok(names.includes('apple-notes'), 'apple-notes not loaded');
  assert.ok(names.includes('apple-reminders'), 'apple-reminders not loaded');
});

test('reformatted overleaf skill parses name/description/body', () => {
  const overleaf = findSkill('overleaf');
  assert.ok(overleaf, 'overleaf skill missing');
  assert.match(overleaf!.description, /Overleaf/);
  // The metadata frontmatter block must not leak into the instruction body.
  assert.doesNotMatch(overleaf!.body, /"emoji"|metadata:/);
  assert.match(overleaf!.body, /Overleaf writing assistant/);
});

test('flat user skills still load, and override a built-in by slug', () => {
  // Flat file (how /compose-skill saves): ~/.handoff/skills/<id>.md
  mkdirSync(SKILLS_DIR, { recursive: true });
  writeFileSync(
    join(SKILLS_DIR, 'my-flat.md'),
    '---\nname: my-flat\ndescription: a flat user skill\n---\n# Do the thing\nstep one.\n',
    'utf-8',
  );
  // Folder-based user skill that overrides the built-in overleaf by slug.
  mkdirSync(join(SKILLS_DIR, 'overleaf'), { recursive: true });
  writeFileSync(
    join(SKILLS_DIR, 'overleaf', 'overleaf.md'),
    '---\nname: overleaf\ndescription: my override\n---\n# Custom overleaf\n',
    'utf-8',
  );

  const skills = loadSkills();
  assert.ok(
    skills.some((s) => s.name === 'my-flat'),
    'flat user skill not loaded',
  );

  const overleaf = findSkill('overleaf')!;
  assert.equal(overleaf.description, 'my override', 'user skill should override built-in by slug');
  assert.match(overleaf.body, /Custom overleaf/);
});
