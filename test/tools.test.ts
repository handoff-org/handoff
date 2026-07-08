import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshHome } from './helpers.js';

// Builtins import workspace modules that read homedir() at load — isolate first.
freshHome();
const { ToolRegistry } = await import('../src/tools/registry.js');
const { registerBuiltins } = await import('../src/tools/builtin.js');
const { createProject } = await import('../src/workspace/project.js');

const reg = new ToolRegistry();
registerBuiltins(reg);

test('network-egress and mutating tools are gated as sensitive', () => {
  assert.equal(reg.isSensitive('web_fetch'), true);
  assert.equal(reg.isSensitive('read_pdf'), true);
  assert.equal(reg.isSensitive('write_file'), true);
  assert.equal(reg.isSensitive('make_dir'), true);
  assert.equal(reg.isSensitive('run_shell'), true);
  // read-only tools stay ungated
  assert.equal(reg.isSensitive('read_file'), false);
  assert.equal(reg.isSensitive('list_dir'), false);
});

test('web_fetch / read_pdf refuse non-http(s) and link-local / metadata URLs', async () => {
  assert.match(await reg.call('web_fetch', { url: 'file:///etc/passwd' }), /Refused/);
  assert.match(
    await reg.call('web_fetch', { url: 'http://169.254.169.254/latest/meta-data/' }),
    /link-local|Refused/,
  );
  assert.match(
    await reg.call('read_pdf', { source: 'http://169.254.169.254/x.pdf' }),
    /link-local|Refused/,
  );
});

test('run_shell executes inside the active project directory, not the launch dir', async () => {
  const meta = createProject({ title: 'Shell Cwd' });
  const out = await reg.call('run_shell', {
    command: 'node -e "process.stdout.write(process.cwd())"',
  });
  assert.ok(out.includes(meta.slug), `expected cwd inside project "${meta.slug}", got: ${out}`);
});

test('write_file append mode adds to a file instead of overwriting', async () => {
  createProject({ title: 'Append Tool' });
  await reg.call('write_file', { path: 'NOTEBOOK.md', content: 'line 1\n' });
  const res = await reg.call('write_file', { path: 'NOTEBOOK.md', content: 'line 2\n', append: 'true' });
  assert.match(res, /Appended to/);
  const readBack = await reg.call('read_file', { path: 'NOTEBOOK.md' });
  assert.match(readBack, /line 1/);
  assert.match(readBack, /line 2/);
});

test('edit_file replaces an exact string in place', async () => {
  createProject({ title: 'Edit One' });
  await reg.call('write_file', { path: 'main.tex', content: 'Hello WORLD, hello there.\n' });
  const res = await reg.call('edit_file', { path: 'main.tex', old_string: 'WORLD', new_string: 'handoff' });
  assert.match(res, /^Edited /);
  assert.match(await reg.call('read_file', { path: 'main.tex' }), /Hello handoff, hello there\./);
});

test('edit_file refuses an ambiguous match unless replace_all', async () => {
  createProject({ title: 'Edit Ambig' });
  await reg.call('write_file', { path: 'f.txt', content: 'x x x\n' });
  const amb = await reg.call('edit_file', { path: 'f.txt', old_string: 'x', new_string: 'y' });
  assert.match(amb, /appears 3 times/);
  const all = await reg.call('edit_file', { path: 'f.txt', old_string: 'x', new_string: 'y', replace_all: 'true' });
  assert.match(all, /Edited/);
  assert.equal((await reg.call('read_file', { path: 'f.txt' })).trim(), 'y y y');
});

test('edit_file reports a missing string and a missing file', async () => {
  createProject({ title: 'Edit Miss' });
  await reg.call('write_file', { path: 'g.txt', content: 'abc\n' });
  assert.match(await reg.call('edit_file', { path: 'g.txt', old_string: 'zzz', new_string: 'q' }), /not found/);
  assert.match(await reg.call('edit_file', { path: 'nope.txt', old_string: 'a', new_string: 'b' }), /not found/);
});

test('edit_file is gated as sensitive', () => {
  assert.equal(reg.isSensitive('edit_file'), true);
  assert.equal(reg.isSensitive('search_files'), false);
  assert.equal(reg.isSensitive('find_files'), false);
});

test('search_files and find_files locate content and paths in the project', async () => {
  createProject({ title: 'Search Proj' });
  await reg.call('write_file', { path: 'notes/todo.md', content: '# TODO\n- fix the loss\n' });
  await reg.call('write_file', { path: 'run.py', content: 'import numpy\n' });
  const grep = await reg.call('search_files', { pattern: 'fix the loss' });
  assert.match(grep, /notes\/todo\.md:2/);
  const glob = await reg.call('find_files', { pattern: '**/*.py' });
  assert.match(glob, /run\.py/);
  assert.match(await reg.call('search_files', { pattern: 'nonexistent-xyz' }), /No matches/);
});

test('read_pdf cleans up its downloaded temp file (no accumulation in tmp)', async () => {
  const { tmpdir } = await import('os');
  const { readdirSync } = await import('fs');
  const tmp = tmpdir();
  const before = readdirSync(tmp).filter((f) => f.startsWith('handoff-pdf-')).length;

  // Stub fetch so no real network is hit; return a small fake body.
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46]), { status: 200 })) as typeof fetch;
  try {
    // pdftotext may or may not be installed; either way the temp file must go.
    await reg.call('read_pdf', { source: 'https://example.com/paper.pdf' });
  } finally {
    globalThis.fetch = realFetch;
  }

  const after = readdirSync(tmp).filter((f) => f.startsWith('handoff-pdf-')).length;
  assert.equal(after, before, 'downloaded temp PDF should be removed after extraction');
});

