import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { freshHome } from './helpers.js';

const home = freshHome();
const { createProject } = await import('../src/workspace/project.js');
const { appendRun } = await import('../src/workspace/ledger.js');
const { parseHandoffFlags, generateHandoffPacket } = await import('../src/workspace/handoff.js');

// ── parseHandoffFlags ──────────────────────────────────────────────────────────

test('parseHandoffFlags defaults to for-me', () => {
  const opts = parseHandoffFlags('');
  assert.equal(opts.mode, 'for-me');
  assert.equal(opts.redact, undefined);
  assert.equal(opts.since, undefined);
});

test('parseHandoffFlags picks up all mode flags', () => {
  assert.equal(parseHandoffFlags('--for-pi').mode, 'for-pi');
  assert.equal(parseHandoffFlags('--for-reviewer').mode, 'for-reviewer');
  assert.equal(parseHandoffFlags('--for-new-student').mode, 'for-new-student');
  assert.equal(parseHandoffFlags('--for-industry-partner').mode, 'for-industry-partner');
});

test('parseHandoffFlags sets redact and since', () => {
  const opts = parseHandoffFlags('--for-industry-partner --redact --since last-week');
  assert.equal(opts.mode, 'for-industry-partner');
  assert.equal(opts.redact, true);
  assert.equal(opts.since, 'last-week');
});

test('parseHandoffFlags handles --output', () => {
  const opts = parseHandoffFlags('--output exports/my-packet.md');
  assert.equal(opts.output, 'exports/my-packet.md');
});

// ── generateHandoffPacket ─────────────────────────────────────────────────────

test('generateHandoffPacket writes exports/handoff-packets/ and returns content', () => {
  const meta = createProject({ title: 'Retrieval Study', description: 'Testing RAG methods.' });
  const { content, outputPath } = generateHandoffPacket(meta, { mode: 'for-me' });

  assert.ok(existsSync(outputPath), 'packet file should be written to disk');
  assert.ok(content.includes('Retrieval Study'), 'packet should contain project title');
  assert.ok(content.includes('for-me'), 'packet should mention mode');
  assert.ok(outputPath.includes('handoff-packets'), 'file should be inside handoff-packets/');
  assert.ok(outputPath.endsWith('-for-me.md'), 'filename should include mode');
});

test('generateHandoffPacket includes best run when ledger has entries', () => {
  const meta = createProject({ title: 'Run Project' });
  appendRun(meta.slug, {
    id: 'run001',
    timestamp: new Date().toISOString(),
    language: 'python',
    description: 'baseline experiment with BM25',
    exitCode: 0,
    durationMs: 45000,
    stdoutPreview: 'F1: 84.2',
  });
  const { content } = generateHandoffPacket(meta, { mode: 'for-me' });
  assert.ok(content.includes('run001'), 'packet should include run id');
  assert.ok(content.includes('baseline experiment'), 'packet should include run description');
});

test('generateHandoffPacket reads RISKS.md when present', () => {
  const meta = createProject({ title: 'Risk Project' });
  const projectRoot = join(home, '.handoff', 'projects', meta.slug);
  writeFileSync(join(projectRoot, 'RISKS.md'), '- no external dataset\n- leakage suspected\n');
  const { content } = generateHandoffPacket(meta, { mode: 'for-me' });
  assert.ok(content.includes('no external dataset'), 'packet should include risks');
  assert.ok(content.includes('leakage suspected'), 'packet should include all risks');
});

test('generateHandoffPacket reads claims.jsonl when present', () => {
  const meta = createProject({ title: 'Claims Project' });
  const projectRoot = join(home, '.handoff', 'projects', meta.slug);
  mkdirSync(join(projectRoot, 'claims'), { recursive: true });
  const claim = JSON.stringify({
    id: 'claim_001',
    text: 'our method improves accuracy by 17.2%',
    status: 'unsupported',
    locations: [{ path: 'paper/main.tex', start_line: 214 }],
  });
  writeFileSync(join(projectRoot, 'claims', 'claims.jsonl'), claim + '\n');
  const { content } = generateHandoffPacket(meta, { mode: 'for-me' });
  assert.ok(content.includes('Unsupported claims'), 'packet should flag unsupported claims');
  assert.ok(content.includes('17.2%'), 'packet should include the claim text');
});

test('generateHandoffPacket appends a note to NOTEBOOK.md', () => {
  const meta = createProject({ title: 'Notebook Project' });
  generateHandoffPacket(meta, { mode: 'for-pi' });
  const projectRoot = join(home, '.handoff', 'projects', meta.slug);
  const notebook = readFileSync(join(projectRoot, 'NOTEBOOK.md'), 'utf-8');
  assert.ok(notebook.includes('handoff packet'), 'NOTEBOOK.md should have a handoff event');
  assert.ok(notebook.includes('for-pi'), 'NOTEBOOK.md event should mention the mode');
});
