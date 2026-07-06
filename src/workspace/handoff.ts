import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';
import { projectDir } from './project.js';
import { readLedger } from './ledger.js';
import { appendNotebook } from '../research/notebook.js';
import { parseJsonl } from '../util/jsonl.js';
import type { ProjectMeta } from './project.js';

export type HandoffMode =
  | 'for-me'
  | 'for-new-student'
  | 'for-pi'
  | 'for-reviewer'
  | 'for-industry-partner';

export interface HandoffOptions {
  mode: HandoffMode;
  since?: string;
  redact?: boolean;
  output?: string;
}

interface ClaimEntry {
  id: string;
  text: string;
  status: string;
  locations?: Array<{ path: string; start_line: number }>;
}

/** Parse /handoff flags from the raw argument string after the command. */
export function parseHandoffFlags(argStr: string): HandoffOptions {
  const args = argStr.trim().split(/\s+/).filter(Boolean);
  const opts: HandoffOptions = { mode: 'for-me' };
  for (let i = 0; i < args.length; i++) {
    const a = (args[i] ?? '').toLowerCase();
    if (a === '--for-me') opts.mode = 'for-me';
    else if (a === '--for-pi') opts.mode = 'for-pi';
    else if (a === '--for-reviewer') opts.mode = 'for-reviewer';
    else if (a === '--for-new-student') opts.mode = 'for-new-student';
    else if (a === '--for-industry-partner') opts.mode = 'for-industry-partner';
    else if (a === '--redact') opts.redact = true;
    else if (a === '--since' && args[i + 1]) opts.since = args[++i];
    else if (a === '--output' && args[i + 1]) opts.output = args[++i];
  }
  return opts;
}

function parseSinceDate(since: string): Date {
  const now = new Date();
  if (since === 'last-week') { now.setDate(now.getDate() - 7); return now; }
  if (since === 'yesterday') { now.setDate(now.getDate() - 1); return now; }
  if (since === 'last-month') { now.setDate(now.getDate() - 30); return now; }
  const d = new Date(since);
  return isNaN(d.getTime()) ? new Date(0) : d;
}

function dateStamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// --- notebook parsing ---

function readNotebookRaw(slug: string): string {
  try {
    const p = join(projectDir(slug), 'NOTEBOOK.md');
    return existsSync(p) ? readFileSync(p, 'utf-8') : '';
  } catch { return ''; }
}

/** Split NOTEBOOK.md into individual entry blocks (each starts with `## YYYY-`). */
function parseNotebookEntries(content: string): string[] {
  const blocks: string[] = [];
  const lines = content.split('\n');
  let current: string[] = [];
  for (const line of lines) {
    if (/^## \d{4}-\d{2}-\d{2}/.test(line)) {
      if (current.length > 0) blocks.push(current.join('\n').trim());
      current = [line];
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) blocks.push(current.join('\n').trim());
  return blocks.filter((b) => /^## \d{4}-\d{2}-\d{2}/.test(b));
}

function entryDate(block: string): Date | null {
  const m = block.match(/^## (\d{4}-\d{2}-\d{2} \d{2}:\d{2})/);
  if (!m || !m[1]) return null;
  return new Date(m[1]);
}

function entryHeader(block: string): string {
  return block.split('\n')[0]?.replace(/^## /, '') ?? '';
}

// --- claims ---

function readClaims(slug: string): ClaimEntry[] {
  try {
    const p = join(projectDir(slug), 'claims', 'claims.jsonl');
    if (!existsSync(p)) return [];
    return parseJsonl<ClaimEntry>(readFileSync(p, 'utf-8'));
  } catch { return []; }
}

// --- risks ---

function readRisks(slug: string): string[] {
  try {
    const p = join(projectDir(slug), 'RISKS.md');
    if (!existsSync(p)) return [];
    return readFileSync(p, 'utf-8')
      .split('\n')
      .filter((l) => /^\s*[-*]\s+/.test(l))
      .map((l) => l.replace(/^\s*[-*]\s+/, '').trim())
      .filter(Boolean);
  } catch { return []; }
}

// --- decisions ---

function readRecentDecisions(slug: string): string[] {
  try {
    const dir = join(projectDir(slug), 'decisions');
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((f) => f.endsWith('.md'))
      .sort().reverse().slice(0, 5)
      .map((f) => {
        const content = readFileSync(join(dir, f), 'utf-8');
        const title = content.match(/^#\s+(.+)/m)?.[1] ?? f.replace(/\.md$/, '');
        const date = f.match(/^(\d{4}-\d{2}-\d{2})/)?.[1];
        return date ? `${date}  ${title}` : title;
      });
  } catch { return []; }
}

// --- files to read first ---

function filesToRead(slug: string): string[] {
  const root = projectDir(slug);
  const files: string[] = ['NOTEBOOK.md'];
  if (existsSync(join(root, 'paper', 'main.tex'))) files.push('paper/main.tex');
  try {
    const csvs = readdirSync(join(root, 'results'))
      .filter((f) => f.endsWith('.csv')).sort().slice(0, 2);
    for (const csv of csvs) files.push(`results/${csv}`);
  } catch { /* no results/ yet */ }
  return files;
}

// --- redaction ---

function redactPaths(text: string): string {
  return text.replace(new RegExp(join(projectDir(''), '/?', '.*?', '/'), 'g'), '<project>/');
}

// --- packet renderer ---

function render(meta: ProjectMeta, opts: HandoffOptions, today: string): string {
  const { slug } = meta;
  const { mode, since, redact } = opts;

  const sinceDate = since ? parseSinceDate(since) : null;
  const allEntries = parseNotebookEntries(readNotebookRaw(slug));
  const recentEntries = sinceDate
    ? allEntries.filter((e) => { const d = entryDate(e); return d && d >= sinceDate; })
    : allEntries.slice(-6);

  const allRuns = readLedger(slug);
  const successfulRuns = allRuns.filter((r) => r.exitCode === 0);
  const bestRun = successfulRuns[successfulRuns.length - 1] ?? null;
  const lastRun = allRuns[allRuns.length - 1] ?? null;

  const claims = readClaims(slug);
  const unsupported = claims.filter(
    (c) => c.status === 'unsupported' || c.status === 'weakly_supported',
  );

  const risks = readRisks(slug);
  const decisions = readRecentDecisions(slug);
  const toRead = filesToRead(slug);

  const lines: string[] = [];
  const push = (...ss: string[]) => lines.push(...ss);

  push(
    `handoff packet · project: ${meta.title}`,
    `generated: ${today} · mode: ${mode}${since ? ` · since: ${since}` : ''}`,
    '',
  );

  if (meta.description) {
    push(`Description:`, `  ${meta.description}`, '');
  }

  // Mode-specific header sections
  if (mode === 'for-reviewer') {
    const totalClaims = claims.length;
    const supported = claims.filter((c) => c.status === 'supported').length;
    if (totalClaims > 0) {
      push(
        'Claims status:',
        `  Total: ${totalClaims}  Supported: ${supported}  Unsupported: ${unsupported.length}`,
        '',
      );
    }
  }

  if (mode === 'for-new-student') {
    push(
      'Setup:',
      '  1. Install handoff: npm install -g handoff',
      '  2. Run: handoff',
      `  3. Open this project: /project ${slug}`,
      `  4. Read NOTEBOOK.md for full history`,
      '',
    );
  }

  // Recent progress
  if (recentEntries.length > 0) {
    const label = mode === 'for-pi' ? 'Progress:' : 'Recent progress:';
    push(label);
    for (const e of recentEntries) push(`  ${entryHeader(e)}`);
    push('');
  }

  // Best run
  const displayRun = bestRun ?? lastRun;
  if (displayRun) {
    const dur = Math.round(displayRun.durationMs / 1000);
    const status = displayRun.exitCode === 0 ? 'successful' : `exit ${displayRun.exitCode}`;
    push(
      `${bestRun ? 'Last successful' : 'Latest'} run:`,
      `  id: ${displayRun.id} · ${displayRun.language} · ${dur}s · ${status}`,
      `  ${displayRun.description}`,
      '',
    );
  }

  // Unsupported claims
  if (unsupported.length > 0) {
    push(`Unsupported claims:  (${unsupported.length})`);
    for (const c of unsupported.slice(0, 5)) {
      const loc = c.locations?.[0];
      const locStr = loc ? `${redact ? '<project>/' : ''}${loc.path}:${loc.start_line}  ` : '';
      const text = c.text.length > 72 ? c.text.slice(0, 72) + '…' : c.text;
      push(`  - ${locStr}"${text}"`);
    }
    push('');
  }

  // Risks
  if (risks.length > 0) {
    push(mode === 'for-reviewer' ? 'Limitations:' : 'Open risks:');
    for (const r of risks) push(`  - ${r}`);
    push('');
  }

  // Decisions
  if (decisions.length > 0 && (mode === 'for-me' || mode === 'for-pi' || mode === 'for-new-student')) {
    push('Recent decisions:');
    for (const d of decisions) push(`  - ${d}`);
    push('');
  }

  // Files to read
  if (mode !== 'for-industry-partner') {
    push('Files to read first:');
    for (const f of toRead) push(`  ${f}`);
    push('');
  }

  // Next actions (heuristic)
  const actions: string[] = [];
  if (unsupported.length > 0)
    actions.push(`link evidence for ${unsupported.length} unsupported claim${unsupported.length > 1 ? 's' : ''} (/audit-paper)`);
  if (risks.length > 0)
    actions.push('address open risks (see above)');
  if (!bestRun && lastRun && lastRun.exitCode !== 0)
    actions.push('investigate last failed run');

  if (actions.length > 0) {
    push('Suggested next actions:');
    actions.forEach((a, i) => push(`  ${i + 1}. ${a}`));
    push('');
  }

  let packet = lines.join('\n');
  if (redact) packet = redactPaths(packet);
  return packet;
}

/** Generate a handoff packet for the given project and options.
 *  Returns the packet content and writes it to exports/handoff-packets/. */
export function generateHandoffPacket(
  meta: ProjectMeta,
  opts: HandoffOptions,
): { content: string; outputPath: string } {
  const today = dateStamp();
  const content = render(meta, opts, today);

  // Write to exports/handoff-packets/
  const slug = meta.slug;
  const dir = join(projectDir(slug), 'exports', 'handoff-packets');
  mkdirSync(dir, { recursive: true });

  const filename = opts.output ?? `${today}-${opts.mode}.md`;
  const outputPath = join(dir, filename);
  writeFileSync(outputPath, content, 'utf-8');

  // Append event to NOTEBOOK.md
  appendNotebook(slug, {
    type: 'note',
    summary: `Generated handoff packet · mode: ${opts.mode}`,
    details: `Saved to: exports/handoff-packets/${filename}`,
  });

  return { content, outputPath };
}
