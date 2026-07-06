import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { projectDir } from './project.js';
import {
  readClaims,
  appendClaim,
  newClaimId,
  type Claim,
  type ClaimType,
  type ClaimLocation,
} from './claims.js';

// ── Patterns ──────────────────────────────────────────────────────────────────

// Numbers immediately followed by a research metric unit.
// Use lookahead instead of \b after the unit because non-word chars like %
// are always preceded by \W (space), so \b never fires after them.
const NUMERICAL_RE =
  /\b(\d+\.?\d*)\s*(pp|%|F1|EM|BLEU|Rouge[-\d]*|accuracy|precision|recall|mAP|AP|AUC|perplexity|tokens?|ms|seconds?|×)(?=\b|\s|[.,;:!?)]|$)/gi;

// Comparison / superiority language.
const COMPARISON_RE =
  /\b(outperform|better than|superior to|improve[sd]? (over|upon|on)|compared to (the )?(strongest|best|prior|previous|state-of-the-art)|over (the )?(baseline|prior work|previous methods?)|surpass(es|ed)?)\b/gi;

// Broad literature sweep claims.
const LITERATURE_RE =
  /\b(prior (work|methods?|approaches?|systems?) (has |have |largely |generally |significantly )?(ignored|overlooked|failed|not addressed|not considered)|existing (methods?|approaches?|systems?) (do not|don't|fail to|cannot|can't|have not)|no previous (work|method|approach|study)|all (prior|previous|existing) (methods?|approaches?|works?) (use|rely|assume|require))\b/gi;

// ── LaTeX sentence extraction ─────────────────────────────────────────────────

/** Strip LaTeX commands and environments for cleaner pattern matching. */
function stripLatex(line: string): string {
  return line
    .replace(/(?<!\d)%.*$/, '')          // remove % comments — but not % after a digit (e.g. 91.3%)
    .replace(/\\[a-zA-Z]+\*?\{[^}]*\}/g, '') // \cmd{arg}
    .replace(/\\[a-zA-Z]+/g, ' ')       // remaining \commands
    .replace(/\$[^$]*\$/g, 'MATH')      // inline math
    .replace(/[{}]/g, '')
    .trim();
}

/** True for lines that are part of a LaTeX environment we should skip. */
function isStructural(line: string): boolean {
  return /^\\(begin|end|section|subsection|subsubsection|chapter|paragraph|label|caption|bibliography|documentclass|usepackage|title|author|date|maketitle|tableofcontents)\b/.test(
    line.trim(),
  );
}

interface TexSentence {
  text: string;
  line: number;
}

/** Extract sentences from a .tex file with approximate line numbers. */
function extractSentences(content: string, filePath: string): TexSentence[] {
  const lines = content.split('\n');
  const sentences: TexSentence[] = [];

  // Build paragraphs, tracking start line.
  let paraLines: string[] = [];
  let paraStart = 0;
  let inVerbatim = false;

  function flushPara() {
    if (paraLines.length === 0) return;
    const paraText = paraLines.map(stripLatex).join(' ').replace(/\s+/g, ' ').trim();
    if (!paraText) { paraLines = []; return; }
    // Split on sentence boundaries: ". " or "? " or "! "
    const raw = paraText.split(/(?<=[.?!])\s+(?=[A-Z])/);
    let offset = 0;
    for (const s of raw) {
      const t = s.trim();
      if (t.length < 20) { offset += s.length + 1; continue; } // skip very short fragments
      // Approximate line: count words in leading text, map to lines.
      const approxLine = paraStart + Math.floor((offset / (paraText.length || 1)) * paraLines.length);
      sentences.push({ text: t, line: Math.max(1, approxLine + 1) });
      offset += s.length + 1;
    }
    paraLines = [];
  }

  void filePath; // used by callers for location

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? '';
    const trimmed = raw.trim();

    if (/\\begin\{(verbatim|lstlisting|minted|code)\}/.test(trimmed)) { inVerbatim = true; continue; }
    if (/\\end\{(verbatim|lstlisting|minted|code)\}/.test(trimmed)) { inVerbatim = false; continue; }
    if (inVerbatim) continue;
    if (isStructural(trimmed)) continue;

    if (trimmed === '') {
      flushPara();
      paraStart = i + 1;
    } else {
      if (paraLines.length === 0) paraStart = i;
      paraLines.push(trimmed);
    }
  }
  flushPara();

  return sentences;
}

// ── Finding builder ───────────────────────────────────────────────────────────

interface Finding {
  text: string;
  type: ClaimType;
  location: ClaimLocation;
}

function scan(sentences: TexSentence[], filePath: string): Finding[] {
  const findings: Finding[] = [];
  for (const s of sentences) {
    const loc: ClaimLocation = { path: filePath, start_line: s.line, end_line: s.line };
    let matched = false;

    if (!matched && NUMERICAL_RE.test(s.text)) {
      findings.push({ text: s.text, type: 'empirical_result', location: loc });
      matched = true;
    }
    NUMERICAL_RE.lastIndex = 0;

    if (!matched && COMPARISON_RE.test(s.text)) {
      findings.push({ text: s.text, type: 'comparison_claim', location: loc });
      matched = true;
    }
    COMPARISON_RE.lastIndex = 0;

    if (!matched && LITERATURE_RE.test(s.text)) {
      findings.push({ text: s.text, type: 'literature_claim', location: loc });
    }
    LITERATURE_RE.lastIndex = 0;
  }
  return findings;
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface AuditResult {
  scanned: string[];        // relative paths scanned
  newCount: number;
  existingCount: number;
  newClaims: Claim[];
  allClaims: Claim[];
}

/** Scan all .tex files in paper/, extract claims, append new ones to claims.jsonl. */
export function auditPaper(slug: string): AuditResult {
  const paperDir = join(projectDir(slug), 'paper');
  const existing = readClaims(slug);

  // Normalise existing claim texts for dedup.
  const seenTexts = new Set(existing.map((c) => normalise(c.text)));

  const scanned: string[] = [];
  const newClaims: Claim[] = [];

  if (!existsSync(paperDir)) {
    return { scanned, newCount: 0, existingCount: existing.length, newClaims, allClaims: existing };
  }

  const texFiles = findTexFiles(paperDir);

  for (const abs of texFiles) {
    const rel = abs.replace(projectDir(slug) + '/', '');
    scanned.push(rel);

    let content = '';
    try { content = readFileSync(abs, 'utf-8'); } catch { continue; }

    const sentences = extractSentences(content, rel);
    const findings = scan(sentences, rel);

    for (const f of findings) {
      const norm = normalise(f.text);
      if (seenTexts.has(norm)) continue;
      seenTexts.add(norm);

      const now = new Date().toISOString();
      const claim: Claim = {
        id: newClaimId(),
        text: f.text,
        type: f.type,
        status: 'unsupported',
        locations: [f.location],
        evidence: [],
        risks: ['No linked evidence'],
        createdAt: now,
        updatedAt: now,
      };
      appendClaim(slug, claim);
      newClaims.push(claim);
    }
  }

  return {
    scanned,
    newCount: newClaims.length,
    existingCount: existing.length,
    newClaims,
    allClaims: [...existing, ...newClaims],
  };
}

function findTexFiles(dir: string): string[] {
  const out: string[] = [];
  try {
    for (const name of readdirSync(dir)) {
      if (name.endsWith('.tex')) out.push(join(dir, name));
    }
  } catch { /* empty dir */ }
  return out.sort();
}

/** Normalise claim text for deduplication: lowercase, collapse whitespace. */
function normalise(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

// ── Audit report formatter ────────────────────────────────────────────────────

export function formatAuditReport(result: AuditResult, projectTitle: string): string {
  const { scanned, newCount, existingCount, newClaims, allClaims } = result;
  const lines: string[] = [`Paper audit — ${projectTitle}`];

  if (scanned.length === 0) {
    lines.push('', 'No .tex files found in paper/. Add your LaTeX files there and re-run.');
    return lines.join('\n');
  }

  lines.push(`Scanned: ${scanned.join(', ')}`);
  lines.push('');

  if (newCount === 0 && existingCount === 0) {
    lines.push('No claims found. The scanner looks for:', '  • numerical results (%, F1, EM, BLEU…)', '  • comparison claims (outperforms, better than…)', '  • literature sweeps (prior work ignored…)');
    return lines.join('\n');
  }

  if (newCount > 0) {
    lines.push(`Found ${newCount} new claim${newCount > 1 ? 's' : ''} (added to claims.jsonl):`);
  } else {
    lines.push('No new claims found — all already tracked.');
  }

  // Group by status
  const byStatus: Record<string, Claim[]> = {};
  for (const c of allClaims) {
    (byStatus[c.status] ??= []).push(c);
  }

  for (const [status, group] of Object.entries(byStatus)) {
    if (group.length === 0) continue;
    lines.push('', `${capitalise(status.replace(/_/g, ' '))}:  (${group.length})`);
    for (const c of group.slice(0, 8)) {
      const loc = c.locations[0];
      const locStr = loc ? `${loc.path}:${loc.start_line}` : '';
      const text = c.text.length > 68 ? c.text.slice(0, 68) + '…' : c.text;
      lines.push(`  ${c.id}  ${locStr}`);
      lines.push(`  "${text}"`);
      if (c.status !== 'supported') {
        lines.push(`  → /claim-link-run ${c.id} <run_id>`);
      }
      lines.push('');
    }
    if (group.length > 8) lines.push(`  … and ${group.length - 8} more — run /claims to see all`);
  }

  const total = allClaims.length;
  const supported = allClaims.filter((c) => c.status === 'supported').length;
  const unsupported = allClaims.filter((c) => c.status === 'unsupported').length;
  lines.push(`Total: ${total}  ✓ ${supported}  ✗ ${unsupported}`);
  lines.push('Run /claims for the full table.');

  return lines.join('\n');
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
