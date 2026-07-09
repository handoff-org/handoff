import { appendFileSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { projectDir } from './project.js';
import { parseJsonl } from '../util/jsonl.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export type ClaimStatus =
  | 'supported'
  | 'weakly_supported'
  | 'unsupported'
  | 'contradicted'
  | 'outdated'
  | 'needs_own_result'
  | 'needs_citation'
  | 'needs_statistical_test';

export type ClaimType =
  | 'empirical_result'
  | 'literature_claim'
  | 'method_claim'
  | 'theory_claim'
  | 'dataset_claim'
  | 'limitation_claim'
  | 'comparison_claim'
  | 'contribution_claim'
  | 'future_work_claim'
  | 'unknown';

export interface ClaimLocation {
  path: string;
  start_line: number;
  end_line: number;
}

export interface EvidenceLink {
  kind: 'run' | 'paper' | 'dataset' | 'note';
  ref: string;
  addedAt: string;
}

export interface Claim {
  id: string;
  text: string;
  type: ClaimType;
  status: ClaimStatus;
  locations: ClaimLocation[];
  evidence: EvidenceLink[];
  risks: string[];
  createdAt: string;
  updatedAt: string;
}

// ── Paths ─────────────────────────────────────────────────────────────────────

export function claimsDir(slug: string): string {
  return join(projectDir(slug), 'claims');
}

export function claimsPath(slug: string): string {
  return join(claimsDir(slug), 'claims.jsonl');
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

export function readClaims(slug: string): Claim[] {
  try {
    const p = claimsPath(slug);
    if (!existsSync(p)) return [];
    return parseJsonl<Claim>(readFileSync(p, 'utf-8'));
  } catch {
    return [];
  }
}

export function writeClaims(slug: string, claims: Claim[]): void {
  mkdirSync(claimsDir(slug), { recursive: true });
  writeFileSync(
    claimsPath(slug),
    claims.map((c) => JSON.stringify(c)).join('\n') + (claims.length ? '\n' : ''),
    'utf-8',
  );
}

export function appendClaim(slug: string, claim: Claim): void {
  mkdirSync(claimsDir(slug), { recursive: true });
  appendFileSync(claimsPath(slug), JSON.stringify(claim) + '\n', 'utf-8');
}

export function updateClaim(slug: string, id: string, patch: Partial<Claim>): Claim | null {
  const all = readClaims(slug);
  const idx = all.findIndex((c) => c.id === id);
  if (idx === -1) return null;
  const updated: Claim = { ...all[idx]!, ...patch, id, updatedAt: new Date().toISOString() };
  all[idx] = updated;
  writeClaims(slug, all);
  return updated;
}

let _seq = 0;
export function newClaimId(): string {
  return `c_${Date.now().toString(36)}_${(++_seq).toString(36)}`;
}

// ── Display ───────────────────────────────────────────────────────────────────

const STATUS_ICON: Record<ClaimStatus, string> = {
  supported: '✓',
  weakly_supported: '~',
  unsupported: '✗',
  contradicted: '!',
  outdated: '↩',
  needs_own_result: '?',
  needs_citation: '?',
  needs_statistical_test: '?',
};

export function claimStatusIcon(s: ClaimStatus): string {
  return STATUS_ICON[s] ?? '?';
}

/** One-line table row for /claims. */
export function formatClaimRow(c: Claim, idWidth: number): string {
  const icon = claimStatusIcon(c.status);
  const loc = c.locations[0];
  const locStr = loc ? `${loc.path}:${loc.start_line}` : '—';
  const text = c.text.length > 55 ? c.text.slice(0, 55) + '…' : c.text;
  return ` ${icon} ${c.id.padEnd(idWidth)}  ${locStr.padEnd(28)}  "${text}"`;
}

/** Multi-line detail block for /claim-status. */
export function formatClaimDetail(c: Claim): string {
  const lines: string[] = [
    `Claim ${c.id}`,
    '',
    `Text:     "${c.text}"`,
    `Type:     ${c.type}`,
    `Status:   ${c.status}`,
  ];
  for (const loc of c.locations) {
    lines.push(`Location: ${loc.path}:${loc.start_line}`);
  }
  if (c.evidence.length > 0) {
    lines.push('', 'Evidence:');
    for (const e of c.evidence) {
      lines.push(`  ${e.kind}  ${e.ref}  (added ${e.addedAt.slice(0, 10)})`);
    }
  } else {
    lines.push('', 'Evidence: (none)');
  }
  if (c.risks.length > 0) {
    lines.push('', 'Risks:');
    for (const r of c.risks) lines.push(`  - ${r}`);
  }
  lines.push('', suggestAction(c));
  return lines.join('\n');
}

function suggestAction(c: Claim): string {
  if (c.status === 'supported') return 'No action needed.';
  if (c.type === 'empirical_result' || c.type === 'comparison_claim') {
    return `Suggested: /claim-link-run ${c.id} <run_id>`;
  }
  if (c.type === 'literature_claim') {
    return `Suggested: /claim-link-paper ${c.id} <citation_key>`;
  }
  return `Suggested: /claim-link-run ${c.id} <run_id>  or  /claim-link-paper ${c.id} <citation_key>`;
}

/** Summary block for /claims. */
export function formatClaimsSummary(claims: Claim[], projectTitle: string): string {
  if (claims.length === 0) {
    return `Claims — ${projectTitle}\n\nNo claims yet. Run /audit-paper to extract them from your LaTeX.`;
  }
  const idWidth = Math.max(6, ...claims.map((c) => c.id.length));
  const rows = claims.map((c) => formatClaimRow(c, idWidth));

  const counts = {
    supported: claims.filter((c) => c.status === 'supported').length,
    weakly: claims.filter((c) => c.status === 'weakly_supported').length,
    unsupported: claims.filter((c) => c.status === 'unsupported').length,
    contradicted: claims.filter((c) => c.status === 'contradicted').length,
    other: claims.filter(
      (c) => !['supported', 'weakly_supported', 'unsupported', 'contradicted'].includes(c.status),
    ).length,
  };

  const rule = '─'.repeat(80);
  return [
    `Claims — ${projectTitle}`,
    '',
    rule,
    ...rows,
    rule,
    ` Total: ${claims.length}  ✓ ${counts.supported}  ~ ${counts.weakly}  ✗ ${counts.unsupported}` +
      (counts.contradicted > 0 ? `  ! ${counts.contradicted}` : '') +
      (counts.other > 0 ? `  ? ${counts.other}` : ''),
  ].join('\n');
}
