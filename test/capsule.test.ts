import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { spawnSync } from 'child_process';
import { freshHome, hasGit } from './helpers.js';

const home = freshHome();
const { createProject, projectPaths } = await import('../src/workspace/project.js');
const { executeRun } = await import('../src/workspace/runner.js');
const { readLedger } = await import('../src/workspace/ledger.js');
const {
  readCapsule,
  listCapsules,
  promoteRun,
  isPromoted,
  formatCompare,
  parseMetrics,
} = await import('../src/workspace/capsule.js');
const { gitState } = await import('../src/util/git.js');

test('executeRun captures a reproducible capsule with metrics, code, and repro.sh', () => {
  const meta = createProject({ title: 'Capsule Test' });
  const p = projectPaths(meta.slug);
  const code = [
    'mkdir -p results',
    `printf '{"accuracy": 0.91}' > results/metrics.json`,
    'echo "METRIC f1=0.88"',
    'echo hello-world',
  ].join('\n');

  const res = executeRun(meta.slug, { language: 'shell', code, description: 'smoke' });
  assert.equal(res.exitCode, 0);

  const dir = join(p.runs, res.capsuleId);
  assert.ok(existsSync(join(dir, 'capsule.json')), 'capsule.json missing');
  assert.ok(existsSync(join(dir, 'repro.sh')), 'repro.sh missing');
  assert.ok(existsSync(join(dir, 'stdout.txt')), 'stdout.txt missing');
  assert.ok(existsSync(join(dir, 'run.sh')), 'saved code file missing');

  const c = readCapsule(meta.slug, res.capsuleId)!;
  assert.equal(c.metrics.accuracy, 0.91, 'metrics.json not parsed');
  assert.equal(c.metrics.f1, 0.88, 'METRIC line not parsed');
  assert.equal(c.code, code, 'exact code not captured');
  // The metrics.json we wrote under results/ is a new output → tracked by hash.
  assert.ok(
    Object.keys(c.outputHashes).some((k) => k.endsWith('metrics.json')),
    'output file not hashed',
  );

  // repro.sh is standalone: it runs the saved code file.
  const repro = readFileSync(join(dir, 'repro.sh'), 'utf-8');
  assert.match(repro, /run\.sh/);
  assert.match(readFileSync(join(dir, 'stdout.txt'), 'utf-8'), /hello-world/);
});

test('the run is recorded in the ledger, linked to its capsule', () => {
  const meta = createProject({ title: 'Ledger Link' });
  const res = executeRun(meta.slug, { language: 'shell', code: 'echo hi', description: 'x' });
  const entry = readLedger(meta.slug).find((r) => r.id === res.capsuleId);
  assert.ok(entry, 'ledger entry missing');
  assert.equal(entry!.capsuleId, res.capsuleId);
  assert.ok(listCapsules(meta.slug).some((c) => c.id === res.capsuleId));
});

test('promoteRun marks a run canonical (and rejects unknown ids)', () => {
  const meta = createProject({ title: 'Promote' });
  const res = executeRun(meta.slug, { language: 'shell', code: 'echo ok', description: 'p' });
  assert.equal(isPromoted(meta.slug, res.capsuleId), false);
  assert.ok(promoteRun(meta.slug, res.capsuleId));
  assert.ok(isPromoted(meta.slug, res.capsuleId));
  assert.equal(promoteRun(meta.slug, 'no-such-run'), false);
});

test('formatCompare reports a metric delta between two runs', () => {
  const meta = createProject({ title: 'Compare' });
  const a = executeRun(meta.slug, { language: 'shell', code: 'echo "METRIC acc=0.80"', description: 'a' });
  const b = executeRun(meta.slug, { language: 'shell', code: 'echo "METRIC acc=0.90"', description: 'b' });
  const out = formatCompare(readCapsule(meta.slug, a.capsuleId)!, readCapsule(meta.slug, b.capsuleId)!);
  assert.match(out, /acc/);
  assert.match(out, /0\.8/);
  assert.match(out, /0\.9/);
  assert.match(out, /\+0\.1/); // delta
});

test('parseMetrics: metrics.json is authoritative, METRIC lines fill the rest', () => {
  const dir = mkdtempSync(join(tmpdir(), 'handoff-metrics-'));
  writeFileSync(join(dir, 'metrics.json'), '{"acc":0.5,"loss":1.2}');
  const m = parseMetrics('noise\nMETRIC f1=0.7\nMETRIC acc=0.99\nMETRIC top-1: 3', dir);
  assert.equal(m.acc, 0.5, 'metrics.json should win over a later METRIC line');
  assert.equal(m.loss, 1.2);
  assert.equal(m.f1, 0.7);
  assert.equal(m['top-1'], 3); // METRIC line with a ":" separator
});

test('gitState: null outside a repo; commit + dirty flag inside one', () => {
  const nonRepo = mkdtempSync(join(tmpdir(), 'handoff-nogit-'));
  assert.equal(gitState(nonRepo), null);

  if (!hasGit()) return; // environment without git — the null case above still holds
  const repo = mkdtempSync(join(tmpdir(), 'handoff-git-'));
  const opts = { cwd: repo, encoding: 'utf-8' as const };
  spawnSync('git', ['init', '-q'], opts);
  writeFileSync(join(repo, 'f.txt'), 'hi');
  spawnSync('git', ['add', '-A'], opts);
  spawnSync('git', ['commit', '-qm', 'init'], opts);

  const st = gitState(repo);
  assert.ok(st && /^[0-9a-f]{7,40}$/.test(st.commit), 'expected a commit hash');
  assert.equal(st!.dirty, false);

  writeFileSync(join(repo, 'f.txt'), 'changed');
  assert.equal(gitState(repo)!.dirty, true);
});
