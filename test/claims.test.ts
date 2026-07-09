import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { freshHome } from './helpers.js';

const home = freshHome();
const { createProject } = await import('../src/workspace/project.js');
const {
  readClaims,
  appendClaim,
  updateClaim,
  writeClaims,
  newClaimId,
  formatClaimsSummary,
  formatClaimDetail,
  claimsPath,
} = await import('../src/workspace/claims.js');
const { auditPaper, formatAuditReport } = await import('../src/workspace/auditor.js');

// ── newClaimId ─────────────────────────────────────────────────────────────────

test('newClaimId returns a non-empty string starting with c_', () => {
  const id = newClaimId();
  assert.ok(id.startsWith('c_'), `expected c_ prefix, got ${id}`);
  assert.ok(id.length > 3);
});

test('newClaimId generates unique ids', () => {
  const ids = new Set(Array.from({ length: 20 }, () => newClaimId()));
  assert.ok(ids.size >= 18, 'expected mostly unique ids');
});

// ── claims CRUD ────────────────────────────────────────────────────────────────

function makeClaim(overrides: Partial<Parameters<typeof appendClaim>[1]> = {}) {
  const now = new Date().toISOString();
  return {
    id: newClaimId(),
    text: 'our method improves accuracy by 17.2%',
    type: 'empirical_result' as const,
    status: 'unsupported' as const,
    locations: [{ path: 'paper/main.tex', start_line: 214, end_line: 214 }],
    evidence: [],
    risks: ['No linked evidence'],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

test('readClaims returns empty array when no claims file exists', () => {
  const meta = createProject({ title: 'Empty Claims' });
  assert.deepEqual(readClaims(meta.slug), []);
});

test('appendClaim creates claims.jsonl and round-trips', () => {
  const meta = createProject({ title: 'Append Claims' });
  const claim = makeClaim();
  appendClaim(meta.slug, claim);
  const read = readClaims(meta.slug);
  assert.equal(read.length, 1);
  assert.equal(read[0]?.id, claim.id);
  assert.equal(read[0]?.text, claim.text);
  assert.equal(read[0]?.status, 'unsupported');
});

test('appendClaim stacks multiple claims', () => {
  const meta = createProject({ title: 'Multi Claims' });
  appendClaim(meta.slug, makeClaim({ text: 'claim one' }));
  appendClaim(meta.slug, makeClaim({ text: 'claim two' }));
  appendClaim(meta.slug, makeClaim({ text: 'claim three' }));
  assert.equal(readClaims(meta.slug).length, 3);
});

test('writeClaims overwrites all claims', () => {
  const meta = createProject({ title: 'Overwrite Claims' });
  appendClaim(meta.slug, makeClaim({ text: 'old claim' }));
  const newClaims = [makeClaim({ text: 'fresh claim' })];
  writeClaims(meta.slug, newClaims);
  const read = readClaims(meta.slug);
  assert.equal(read.length, 1);
  assert.equal(read[0]?.text, 'fresh claim');
});

test('updateClaim modifies a claim in place and updates updatedAt', () => {
  const meta = createProject({ title: 'Update Claims' });
  const claim = makeClaim();
  appendClaim(meta.slug, claim);
  const updated = updateClaim(meta.slug, claim.id, { status: 'supported' });
  assert.ok(updated, 'updateClaim should return the updated claim');
  assert.equal(updated?.status, 'supported');
  // Read back to verify persistence
  const read = readClaims(meta.slug);
  assert.equal(read[0]?.status, 'supported');
});

test('updateClaim returns null for unknown id', () => {
  const meta = createProject({ title: 'Unknown Claim' });
  const result = updateClaim(meta.slug, 'c_nonexistent', { status: 'supported' });
  assert.equal(result, null);
});

// ── display formatters ─────────────────────────────────────────────────────────

test('formatClaimsSummary shows "no claims" message when empty', () => {
  const out = formatClaimsSummary([], 'Test Project');
  assert.ok(out.includes('No claims yet'));
  assert.ok(out.includes('/audit-paper'));
});

test('formatClaimsSummary shows counts when claims exist', () => {
  const claims = [
    makeClaim({ status: 'supported' }),
    makeClaim({ status: 'unsupported' }),
    makeClaim({ status: 'unsupported' }),
  ];
  const out = formatClaimsSummary(claims, 'My Project');
  assert.ok(out.includes('Total: 3'));
  assert.ok(out.includes('✓ 1'));
  assert.ok(out.includes('✗ 2'));
});

test('formatClaimDetail shows id, text, status, location, and action', () => {
  const claim = makeClaim();
  const out = formatClaimDetail(claim);
  assert.ok(out.includes(claim.id));
  assert.ok(out.includes('17.2%'));
  assert.ok(out.includes('unsupported'));
  assert.ok(out.includes('paper/main.tex'));
  assert.ok(out.includes('/claim-link-run'));
});

// ── auditor ────────────────────────────────────────────────────────────────────

function writeTex(projectRoot: string, filename: string, content: string) {
  const paperDir = join(projectRoot, 'paper');
  mkdirSync(paperDir, { recursive: true });
  writeFileSync(join(paperDir, filename), content, 'utf-8');
}

test('auditPaper returns empty when no paper/ directory', () => {
  const meta = createProject({ title: 'No Paper' });
  const result = auditPaper(meta.slug);
  assert.equal(result.scanned.length, 0);
  assert.equal(result.newCount, 0);
});

test('auditPaper detects numerical claims', () => {
  const meta = createProject({ title: 'Numerical Claims' });
  const root = join(home, '.handoff', 'projects', meta.slug);
  writeTex(
    root,
    'main.tex',
    [
      '\\section{Results}',
      '',
      'Our model achieves 84.2 F1 on the SQuAD benchmark.',
      '',
      'This represents a 5.1% improvement over the BM25 baseline.',
    ].join('\n'),
  );

  const result = auditPaper(meta.slug);
  assert.ok(result.newCount >= 1, `expected at least 1 numerical claim, got ${result.newCount}`);
  assert.ok(
    result.newClaims.some((c) => c.type === 'empirical_result'),
    'expected at least one empirical_result type',
  );
  // All new claims are unsupported
  assert.ok(result.newClaims.every((c) => c.status === 'unsupported'));
});

test('auditPaper detects comparison claims', () => {
  const meta = createProject({ title: 'Comparison Claims' });
  const root = join(home, '.handoff', 'projects', meta.slug);
  writeTex(
    root,
    'main.tex',
    [
      '\\section{Results}',
      '',
      'Our method outperforms all prior approaches on both benchmarks.',
      '',
      'We achieve results better than the strongest baseline.',
    ].join('\n'),
  );

  const result = auditPaper(meta.slug);
  assert.ok(result.newCount >= 1, `expected at least 1 comparison claim, got ${result.newCount}`);
  assert.ok(result.newClaims.some((c) => c.type === 'comparison_claim'));
});

test('auditPaper detects literature sweep claims', () => {
  const meta = createProject({ title: 'Literature Claims' });
  const root = join(home, '.handoff', 'projects', meta.slug);
  writeTex(
    root,
    'related.tex',
    [
      '\\section{Related Work}',
      '',
      'Prior work has largely ignored low-resource settings in this domain.',
      '',
      'No previous study has examined the effect of retrieval depth on F1.',
    ].join('\n'),
  );

  const result = auditPaper(meta.slug);
  assert.ok(result.newCount >= 1, `expected at least 1 literature claim, got ${result.newCount}`);
  assert.ok(result.newClaims.some((c) => c.type === 'literature_claim'));
});

test('auditPaper deduplicates: running twice does not double-add claims', () => {
  const meta = createProject({ title: 'Dedup Claims' });
  const root = join(home, '.handoff', 'projects', meta.slug);
  writeTex(
    root,
    'main.tex',
    'Our model achieves 84.2 F1 on the benchmark.\n\nWe outperform all prior methods.',
  );

  const first = auditPaper(meta.slug);
  const second = auditPaper(meta.slug);
  assert.ok(first.newCount > 0);
  assert.equal(second.newCount, 0, 'second audit should add no new claims');
  assert.equal(second.existingCount, first.newCount + first.existingCount);
});

test('auditPaper persists claims to claims.jsonl', () => {
  const meta = createProject({ title: 'Persist Claims' });
  const root = join(home, '.handoff', 'projects', meta.slug);
  writeTex(root, 'main.tex', 'We achieve 91.3% accuracy on the test set.');

  auditPaper(meta.slug);
  assert.ok(existsSync(claimsPath(meta.slug)), 'claims.jsonl should be created');
  const claims = readClaims(meta.slug);
  assert.ok(claims.length >= 1);
});

test('formatAuditReport shows "no .tex files" when nothing scanned', () => {
  const meta = createProject({ title: 'Empty Audit' });
  const result = auditPaper(meta.slug);
  const report = formatAuditReport(result, meta.title);
  assert.ok(report.includes('No .tex files'));
});

test('formatAuditReport shows new claim count and action hints', () => {
  const meta = createProject({ title: 'Report Claims' });
  const root = join(home, '.handoff', 'projects', meta.slug);
  writeTex(root, 'main.tex', 'Our method achieves 87.1 F1, outperforming all baselines.');
  const result = auditPaper(meta.slug);
  const report = formatAuditReport(result, meta.title);
  assert.ok(report.includes('new claim'));
  assert.ok(report.includes('/claim-link-run'));
});
