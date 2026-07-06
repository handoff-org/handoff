import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { freshHome } from './helpers.js';

const home = freshHome();
const { createProject, updateProject, projectPaths } = await import('../src/workspace/project.js');
const {
  buildSystem,
  projectContext,
  starterTex,
  escapeLatex,
  sanitizeBibBase,
  resolveProfile,
  describePrompt,
  SYSTEM_PROMPT_VERSION,
} = await import('../src/agent/systemPrompt.js');
const { ToolRegistry } = await import('../src/tools/registry.js');
const { registerBuiltins } = await import('../src/tools/builtin.js');

// ── Profiles & assembly ──────────────────────────────────────────────────────

test('general/off-work mode excludes project + Overleaf context', () => {
  const meta = createProject({ title: 'Gen Mode' });
  const sys = buildSystem('BASE', meta, { focus: 'general' });
  assert.doesNotMatch(sys, /Active project/);
  assert.doesNotMatch(sys, /auto-syncs to Overleaf|Overleaf-linked/i);
  // still keeps safety-critical guidance
  assert.match(sys, /write_file/);
  assert.match(sys, /Untrusted content/);
});

test('no-project prompt has no project paths or Overleaf rules', () => {
  const sys = buildSystem('BASE', null);
  assert.doesNotMatch(sys, /Active project/);
  assert.doesNotMatch(sys, /auto-syncs to Overleaf|Overleaf-linked/i);
});

test('with existing projects and none open, prompt offers a chooser + open_project', () => {
  createProject({ title: 'Alpha Study' });
  createProject({ title: 'Beta Study' });
  const sys = buildSystem('BASE', null);
  // Names the existing projects and directs the agent to let the user pick one.
  assert.match(sys, /none is open/i);
  assert.match(sys, /open_project/);
  assert.match(sys, /Start a new project/);
  assert.match(sys, /alpha-study|beta-study/);
});

test('active non-Overleaf project includes the directory map and root-relative rule', () => {
  const meta = createProject({ title: 'Dir Map' });
  const sys = buildSystem('BASE', meta);
  assert.match(sys, /Active project/);
  assert.match(sys, /resolve to the project/i);
  assert.match(sys, /main\.tex/);
  assert.match(sys, /refs\.bib/);
});

test('Overleaf project with existing main .tex enforces single-document edit-in-place', () => {
  const meta = createProject({ title: 'Solo Doc' });
  updateProject(meta.slug, { paperMode: 'overleaf' });
  const paper = projectPaths(meta.slug).paper;
  writeFileSync(join(paper, 'main.tex'), '\\documentclass{article}\\begin{document}\\end{document}');
  const sys = buildSystem('BASE', { ...meta, paperMode: 'overleaf' } as never, { promptProfile: 'strict_paper' });
  assert.match(sys, /ONE document/);
  assert.match(sys, /auto-syncs to Overleaf/);
});

test('Overleaf project with no .tex directs ask_user then start_paper', () => {
  const meta = createProject({ title: 'Empty Overleaf' });
  updateProject(meta.slug, { paperMode: 'overleaf' });
  const sys = buildSystem('BASE', { ...meta, paperMode: 'overleaf' } as never);
  assert.match(sys, /ask_user/);
  assert.match(sys, /start_paper/);
});

test('prompt includes an explicit priority order resolving tool/ask conflicts', () => {
  const sys = buildSystem('BASE', null);
  assert.match(sys, /priority order/i);
  assert.match(sys, /read-before-edit/i);
});

test('prompt includes untrusted-content / prompt-injection guidance', () => {
  const sys = buildSystem('BASE', null);
  assert.match(sys, /Untrusted content/);
  assert.match(sys, /not instructions|DATA, not/i);
});

test('compact profile is materially shorter than strict_paper while keeping safety substrings', () => {
  const meta = createProject({ title: 'Len Check' });
  const compact = buildSystem('BASE', meta, { promptProfile: 'compact' });
  const strict = buildSystem('BASE', meta, { promptProfile: 'strict_paper' });
  assert.ok(compact.length < strict.length, `compact ${compact.length} should be < strict ${strict.length}`);
  for (const must of [/write_file/, /ask_user/, /Untrusted content/, /priority order/i]) {
    assert.match(compact, must);
  }
});

test('prompt does not repeat the bibliography-style instruction excessively', () => {
  const meta = createProject({ title: 'No Repeat' });
  updateProject(meta.slug, { paperMode: 'overleaf' });
  const paper = projectPaths(meta.slug).paper;
  writeFileSync(join(paper, 'main.tex'), '\\documentclass{article}\\begin{document}\\end{document}');
  const sys = buildSystem('BASE', { ...meta, paperMode: 'overleaf' } as never, { promptProfile: 'strict_paper' });
  const count = (sys.match(/bibliographystyle\{plainnat\}/g) ?? []).length;
  assert.ok(count <= 2, `bibliographystyle repeated ${count} times`);
});

test('resolveProfile picks strict_paper for Overleaf and general for off-work', () => {
  const meta = createProject({ title: 'Profile Pick' });
  updateProject(meta.slug, { paperMode: 'overleaf' });
  assert.equal(resolveProfile({ ...meta, paperMode: 'overleaf' } as never, {}), 'strict_paper');
  assert.equal(resolveProfile(null, { focus: 'general' }), 'general');
});

test('describePrompt reports profile, length, and version', () => {
  const d = describePrompt('BASE', null);
  assert.ok(d.length > 0);
  assert.equal(d.version, SYSTEM_PROMPT_VERSION);
  assert.ok(['compact', 'standard', 'strict_paper', 'general'].includes(d.profile));
});

// ── write_file honesty: append must actually exist ────────────────────────────

test('prompt advertises append mode only because write_file supports it', () => {
  const sys = buildSystem('BASE', createProject({ title: 'Append Check' }));
  const mentionsAppend = /append/i.test(sys);
  const reg = new ToolRegistry();
  registerBuiltins(reg);
  const schema = reg.getSchemas().find((s) => s.function.name === 'write_file');
  const hasAppendParam = !!schema && 'append' in schema.function.parameters.properties;
  // If the prompt mentions append, the tool must support it.
  if (mentionsAppend) assert.ok(hasAppendParam, 'prompt mentions append but write_file has no append param');
});

// ── model-family hints ────────────────────────────────────────────────────────

test('model-family hint is injected and short', () => {
  const sys = buildSystem('BASE', null, { modelFamily: 'ornith' });
  assert.match(sys, /Model note:/);
  assert.match(sys, /coding agent/i);
});

// ── starterTex hardening ──────────────────────────────────────────────────────

test('escapeLatex escapes &, %, _, #, $, braces, and backslash', () => {
  const out = escapeLatex('A & B 50% x_y #1 $z {a} \\cmd');
  assert.doesNotMatch(out, /(^|[^\\])&/); // no bare &
  assert.match(out, /\\&/);
  assert.match(out, /\\%/);
  assert.match(out, /\\_/);
  assert.match(out, /\\#/);
  assert.match(out, /\\\$/);
  assert.match(out, /\\\{a\\\}/);
  assert.match(out, /textbackslash/);
});

test('sanitizeBibBase strips path, extension, and unsafe chars; falls back to refs', () => {
  assert.equal(sanitizeBibBase('refs.bib'), 'refs');
  assert.equal(sanitizeBibBase('/etc/passwd'), 'passwd');
  assert.equal(sanitizeBibBase('../../evil.bib'), 'evil');
  assert.equal(sanitizeBibBase('a b;rm -rf/'), 'abrm-rf');
  assert.equal(sanitizeBibBase(''), 'refs');
  assert.equal(sanitizeBibBase('...'), 'refs');
});

test('starterTex sanitizes a hostile title and bibBase and stays structurally valid', () => {
  const tex = starterTex('Cost & Effect: 50% $ _gain', '../refs.bib; \\input{x}');
  // structure
  assert.equal((tex.match(/\\documentclass/g) ?? []).length, 1);
  assert.equal((tex.match(/\\begin\{document\}/g) ?? []).length, 1);
  assert.ok(tex.trimEnd().endsWith('\\end{document}'));
  assert.match(tex, /\\usepackage\{natbib\}/);
  // bibliographystyle appears before bibliography
  assert.ok(tex.indexOf('\\bibliographystyle{plainnat}') < tex.indexOf('\\bibliography{'));
  // title escaped: no bare & or % inside \title
  const title = tex.match(/\\title\{([^\n]*)\}/)![1]!;
  assert.doesNotMatch(title, /(^|[^\\])&/);
  assert.match(title, /\\&/);
  // bibBase sanitized: no path, no braces from \input
  assert.match(tex, /\\bibliography\{[A-Za-z0-9._-]+\}/);
  assert.doesNotMatch(tex, /\\input\{x\}/);
  // exactly one trailing newline
  assert.ok(tex.endsWith('\\end{document}\n'));
  assert.ok(!tex.endsWith('\n\n'));
});
