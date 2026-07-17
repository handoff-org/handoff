import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshHome } from './helpers.js';

// Isolate HOME before importing modules that read homedir() at load.
freshHome();
const { createProject } = await import('../src/workspace/project.js');
const { writeCapsule } = await import('../src/workspace/capsule.js');
const { appendClaim, readClaims, newClaimId } = await import('../src/workspace/claims.js');
const { extractNumbers, numbersMatch, checkProvenance, applyProvenanceVerdicts } =
  await import('../src/workspace/provenance.js');
import type { Capsule } from '../src/workspace/capsule.js';
import type { Claim } from '../src/workspace/claims.js';

// ── Pure helpers ──────────────────────────────────────────────────────────────

test('extractNumbers: pulls decimals and percents, skips years and glued tokens', () => {
  assert.deepEqual(
    extractNumbers('We reach 0.92 accuracy (92%) in 2021, up from 0.85 (model v2).').map(
      (n) => n.value,
    ),
    [0.92, 92, 0.85],
  );
});

test('numbersMatch: exact, within tolerance, percent-vs-fraction, and clear mismatch', () => {
  assert.equal(numbersMatch(0.89, 0.89), true);
  assert.equal(numbersMatch(0.891, 0.89), true); // within 1%
  assert.equal(numbersMatch(92, 0.92), true); // percent vs fraction
  assert.equal(numbersMatch(0.92, 0.89), false);
});

// ── Integration ─────────────────────────────────────────────────────────────

function fakeCapsule(id: string, metrics: Record<string, number>): Capsule {
  return {
    id,
    language: 'python',
    code: 'print(1)',
    cwd: '/tmp',
    git: null,
    env: {},
    seeds: {},
    metrics,
    inputHashes: {},
    outputHashes: {},
    exitCode: 0,
    durationMs: 5,
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: '2026-01-01T00:00:01.000Z',
  };
}

function claim(slug: string, text: string, runId?: string): string {
  const id = newClaimId();
  const now = new Date().toISOString();
  const c: Claim = {
    id,
    text,
    type: 'empirical_result',
    status: 'unsupported',
    locations: [{ path: 'paper/main.tex', start_line: 10, end_line: 10 }],
    evidence: runId ? [{ kind: 'run', ref: runId, addedAt: now }] : [],
    risks: [],
    createdAt: now,
    updatedAt: now,
  };
  appendClaim(slug, c);
  return id;
}

test('checkProvenance flags a stale claim and applyProvenanceVerdicts marks it outdated', () => {
  const meta = createProject({ title: 'Stale Check' });
  writeCapsule(meta.slug, fakeCapsule('r1', { accuracy: 0.89 }), { stdout: '', stderr: '' });

  const staleId = claim(meta.slug, 'Our model reaches 0.92 accuracy.', 'r1');
  const freshId = claim(meta.slug, 'Our model reaches 0.89 accuracy.', 'r1');
  const unlinkedId = claim(meta.slug, 'Accuracy is 0.50 in prior work.'); // no run link

  const verdicts = checkProvenance(meta.slug);
  const byId = new Map(verdicts.map((v) => [v.claimId, v]));

  assert.equal(byId.get(staleId)?.status, 'stale');
  assert.deepEqual(byId.get(staleId)?.nearest, { metric: 'accuracy', value: 0.89 });
  assert.equal(byId.get(freshId)?.status, 'current');
  assert.equal(byId.has(unlinkedId), false, 'claims with no run link are not verified');

  const { markedOutdated } = applyProvenanceVerdicts(meta.slug, verdicts);
  assert.equal(markedOutdated, 1);
  const persisted = readClaims(meta.slug).find((c) => c.id === staleId);
  assert.equal(persisted?.status, 'outdated');
  assert.match(persisted?.risks[0] ?? '', /0\.92.*0\.89/);
});

test('a previously-outdated claim recovers when its number matches again', () => {
  const meta = createProject({ title: 'Recover Check' });
  writeCapsule(meta.slug, fakeCapsule('r1', { accuracy: 0.89 }), { stdout: '', stderr: '' });
  const id = claim(meta.slug, 'Our model reaches 0.92 accuracy.', 'r1');

  // First pass: mismatch → outdated.
  applyProvenanceVerdicts(meta.slug, checkProvenance(meta.slug));
  assert.equal(readClaims(meta.slug).find((c) => c.id === id)?.status, 'outdated');

  // The run is re-run and now reports 0.92 → the paper number matches again.
  writeCapsule(meta.slug, fakeCapsule('r1', { accuracy: 0.92 }), { stdout: '', stderr: '' });
  const { recovered } = applyProvenanceVerdicts(meta.slug, checkProvenance(meta.slug));
  assert.equal(recovered, 1);
  assert.equal(readClaims(meta.slug).find((c) => c.id === id)?.status, 'weakly_supported');
});
