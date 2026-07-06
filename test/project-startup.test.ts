import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshHome } from './helpers.js';

// Fresh, empty HOME — this file is its own process, so no projects exist yet
// when the first test runs. Import project.js AFTER pointing HOME at the tmp dir.
freshHome();
const { buildSystem } = await import('../src/agent/systemPrompt.js');
const { createProject } = await import('../src/workspace/project.js');

test('with NO projects, the prompt drives create_project and defers the template to the app', () => {
  // Must run before any createProject below so listProjects() is empty.
  const sys = buildSystem('BASE', null);
  assert.match(sys, /No research project exists yet/i);
  assert.match(sys, /create_project/);
  // The app owns the template chooser now — the model must NOT ask about it.
  assert.match(sys, /template chooser/i);
  assert.match(sys, /do NOT ask about, pick, or set up the/);
  // Should not interrogate for a description.
  assert.match(sys, /do not ask for a description/i);
});

test('once a project exists, the prompt switches to the chooser + open_project', () => {
  createProject({ title: 'First Study' });
  const sys = buildSystem('BASE', null);
  assert.match(sys, /none is open/i);
  assert.match(sys, /open_project/);
  assert.match(sys, /first-study/);
});
