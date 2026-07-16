import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { freshHome } from './helpers.js';

// Isolate HOME before importing — resolveWorkspacePath/PROJECTS_DIR are fixed at load time.
const home = freshHome();
const { createProject, setActiveProject, PROJECTS_DIR } =
  await import('../src/workspace/project.js');
const { registerFilesystemTools } = await import('../src/tools/builtin/filesystem.js');
const { ToolRegistry } = await import('../src/tools/registry.js');

function makeRegistry() {
  const reg = new ToolRegistry();
  registerFilesystemTools(reg);
  return reg;
}

async function call(reg: ToolRegistry, name: string, args: Record<string, unknown>) {
  const tool = reg['tools'].get(name);
  if (!tool) throw new Error(`tool ${name} not found`);
  return tool.execute(args);
}

// ── read_file ───────────────────────────────────────────────────────────────

test('read_file: reads a file inside the active project (relative path)', async () => {
  await mkdir(PROJECTS_DIR, { recursive: true });
  createProject({ title: 'fs-test-read' });
  const projectRoot = join(PROJECTS_DIR, 'fs-test-read');
  await writeFile(join(projectRoot, 'hello.txt'), 'hello world', 'utf-8');

  const reg = makeRegistry();
  const result = await call(reg, 'read_file', { path: 'hello.txt' });
  assert.equal(result, 'hello world');
});

test('read_file: reads an absolute path outside the project (intentionally allowed)', async () => {
  const outsideFile = join(home, 'outside.txt');
  await writeFile(outsideFile, 'outside content', 'utf-8');

  const reg = makeRegistry();
  const result = await call(reg, 'read_file', { path: outsideFile });
  assert.equal(result, 'outside content');
});

test('read_file: rejects with ENOENT for a non-existent file', async () => {
  const reg = makeRegistry();
  await assert.rejects(
    () => call(reg, 'read_file', { path: '/no/such/file/xyz123.txt' }),
    /ENOENT/,
  );
});

// ── list_dir ────────────────────────────────────────────────────────────────

test('list_dir: lists the project root when no path given', async () => {
  await mkdir(PROJECTS_DIR, { recursive: true });
  createProject({ title: 'fs-test-list' });
  const projectRoot = join(PROJECTS_DIR, 'fs-test-list');
  await writeFile(join(projectRoot, 'note.md'), '# note', 'utf-8');

  setActiveProject('fs-test-list');
  const reg = makeRegistry();
  const result = (await call(reg, 'list_dir', {})) as string;
  assert.ok(result.includes('note.md'), `expected note.md in: ${result}`);
});

test('list_dir: refuses absolute path outside the project', async () => {
  // Ensure we have an active project so isWithinProject has a root to check against.
  await mkdir(PROJECTS_DIR, { recursive: true });
  createProject({ title: 'fs-test-guard' });
  setActiveProject('fs-test-guard');

  const reg = makeRegistry();
  const result = (await call(reg, 'list_dir', { path: home })) as string;
  assert.ok(result.startsWith('Refused:'), `expected refusal, got: ${result}`);
});

// ── write_file ──────────────────────────────────────────────────────────────

test('write_file: writes a relative path inside the active project', async () => {
  await mkdir(PROJECTS_DIR, { recursive: true });
  createProject({ title: 'fs-test-write' });
  setActiveProject('fs-test-write');

  const reg = makeRegistry();
  const result = await call(reg, 'write_file', { path: 'output.txt', content: 'data' });
  assert.ok((result as string).includes('output.txt'));

  const projectRoot = join(PROJECTS_DIR, 'fs-test-write');
  const { readFile } = await import('fs/promises');
  const written = await readFile(join(projectRoot, 'output.txt'), 'utf-8');
  assert.equal(written, 'data');
});

test('write_file: refuses absolute path outside the project', async () => {
  await mkdir(PROJECTS_DIR, { recursive: true });
  createProject({ title: 'fs-test-write-guard' });
  setActiveProject('fs-test-write-guard');

  const reg = makeRegistry();
  const outsidePath = join(home, 'should-not-exist.txt');
  const result = (await call(reg, 'write_file', { path: outsidePath, content: 'x' })) as string;
  assert.ok(result.startsWith('Refused:'), `expected refusal, got: ${result}`);
});
