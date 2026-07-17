import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { freshHome } from './helpers.js';

// Isolate HOME before importing modules that read homedir() at load.
freshHome();
const { ToolRegistry } = await import('../src/tools/registry.js');
const { registerReportTools } = await import('../src/workspace/report.js');
const { createProject, projectPaths } = await import('../src/workspace/project.js');
const { initPaper } = await import('../src/workspace/paper.js');
const { writeCapsule } = await import('../src/workspace/capsule.js');
import type { Capsule } from '../src/workspace/capsule.js';

const reg = new ToolRegistry();
registerReportTools(reg);

function fakeCapsule(over: Partial<Capsule>): Capsule {
  return {
    id: 'run-1',
    language: 'python',
    code: 'print(1)',
    cwd: '/tmp',
    git: null,
    env: {},
    seeds: {},
    metrics: { accuracy: 0.947, loss: 0.21 },
    inputHashes: {},
    outputHashes: {},
    exitCode: 0,
    durationMs: 12,
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: '2026-01-01T00:00:01.000Z',
    ...over,
  };
}

/** Drop a real file under the project's results/ dir (source for figure copy). */
function seedResultFile(slug: string, rel: string, bytes = 'PNG'): void {
  const p = join(projectPaths(slug).results, rel);
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, bytes);
}

test('export_results is gated as a sensitive tool', () => {
  assert.equal(reg.isSensitive('export_results'), true);
});

test('export_results reports clearly when there are no runs', async () => {
  createProject({ title: 'No Runs' });
  const out = await reg.call('export_results', {});
  assert.match(out, /No matching runs/);
});

test('export_results builds a table, copies figures into paper/, and saves an artifact', async () => {
  const meta = createProject({ title: 'Export Full' });
  initPaper(meta, 'blank');
  seedResultFile(meta.slug, 'figures/loss.png');
  writeCapsule(
    meta.slug,
    fakeCapsule({ outputHashes: { 'figures/loss.png': 'h1', 'metrics.json': 'h2' } }),
    { stdout: '', stderr: '' },
  );

  const out = await reg.call('export_results', {});
  assert.match(out, /\\begin\{table\}/);
  assert.match(out, /accuracy & 0\.947/);
  assert.match(out, /\\includegraphics\[width=0\.8\\linewidth\]\{figures\/loss\.png\}/);

  // Figure copied into the synced paper folder.
  assert.ok(
    existsSync(join(projectPaths(meta.slug).paper, 'figures', 'loss.png')),
    'figure must be copied into paper/figures/',
  );
  // Durable artifact saved under results/tables/.
  const artifact = join(projectPaths(meta.slug).results, 'tables', 'results.tex');
  assert.ok(existsSync(artifact), 'results/tables/results.tex must be written');
  assert.match(readFileSync(artifact, 'utf-8'), /\\begin\{table\}/);
});

test('export_results without a paper returns the table but skips figures with a note', async () => {
  const meta = createProject({ title: 'Export No Paper' });
  seedResultFile(meta.slug, 'figures/curve.png');
  writeCapsule(meta.slug, fakeCapsule({ outputHashes: { 'figures/curve.png': 'h1' } }), {
    stdout: '',
    stderr: '',
  });

  const out = await reg.call('export_results', {});
  assert.match(out, /\\begin\{table\}/);
  assert.doesNotMatch(out, /\\includegraphics/);
  assert.match(out, /start_paper/);
  assert.equal(
    existsSync(join(projectPaths(meta.slug).paper, 'figures', 'curve.png')),
    false,
    'no figure should be copied when there is no paper',
  );
});
