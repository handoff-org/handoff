import { basename } from 'path';
import { escapeLatex } from '../agent/latex.js';
import { summarizeMetric } from './statsReport.js';

// Pure, I/O-free rendering of experiment results into paper-ready artifacts:
// a metrics table (LaTeX booktabs + GitHub-flavored markdown) and figure blocks.
// Everything here is deterministic and unit-testable; the export_results tool
// (report.ts) does the filesystem work and calls into this module.

const FIG_EXT = new Set(['.png', '.pdf', '.jpg', '.jpeg', '.pgf', '.eps', '.svg']);

/** True when a results-relative path looks like an includable figure. */
export function isFigureFile(path: string): boolean {
  const dot = path.lastIndexOf('.');
  return dot >= 0 && FIG_EXT.has(path.slice(dot).toLowerCase());
}

/**
 * A safe LaTeX label/id stem: only [A-Za-z0-9_-], no leading dash/underscore,
 * falling back to "results". Mirrors sanitizeBibBase in agent/latex.ts.
 */
export function sanitizeRef(raw: string): string {
  const cleaned = String(raw ?? '')
    .replace(/[^A-Za-z0-9_-]/g, '')
    .replace(/^[-_]+/, '');
  return cleaned || 'results';
}

/**
 * Format a metric for display: integers verbatim, other numbers to 4 significant
 * figures with trailing-zero noise trimmed (0.947, 1235, 0.3). Non-finite values
 * (NaN/Infinity) pass through as their string form.
 */
export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  if (Number.isInteger(n)) return String(n);
  return String(parseFloat(n.toPrecision(4)));
}

export interface ResultRow {
  label: string;
  metrics: Record<string, number>;
}

export interface TableOptions {
  /** Restrict/order the metric columns; default = sorted union across rows. */
  keys?: string[];
  caption?: string;
  label?: string;
}

/** Missing cell placeholder (LaTeX + markdown both render an en-dash-ish dash). */
const MISSING = '--';

function unionKeys(rows: ResultRow[]): string[] {
  const s = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r.metrics)) s.add(k);
  return [...s].sort();
}

function cell(v: number | undefined): string {
  return v === undefined ? MISSING : formatNumber(v);
}

function latexTable(
  columnSpec: string,
  header: string[],
  bodyRows: string[][],
  caption: string,
  label: string,
): string {
  const esc = (s: string) => escapeLatex(s);
  const line = (cells: string[]) => cells.join(' & ') + ' \\\\';
  return [
    '\\begin{table}[t]',
    '\\centering',
    `\\begin{tabular}{${columnSpec}}`,
    '\\toprule',
    line(header.map(esc)),
    '\\midrule',
    ...bodyRows.map((r) => line(r)),
    '\\bottomrule',
    '\\end{tabular}',
    `\\caption{${esc(caption)}}`,
    `\\label{tab:${label}}`,
    '\\end{table}',
  ].join('\n');
}

function markdownTable(header: string[], bodyRows: string[][]): string {
  const row = (cells: string[]) => `| ${cells.join(' | ')} |`;
  return [row(header), row(header.map(() => '---')), ...bodyRows.map(row)].join('\n');
}

/**
 * Render one or more runs' metrics as a table. A single run becomes a
 * two-column Metric / Value table; multiple runs become a Run × metrics matrix.
 * Metric columns are `opts.keys` (order preserved) or the sorted union.
 * Returns both a LaTeX (booktabs) and a markdown rendering of the same data.
 */
export function metricsTable(
  rows: ResultRow[],
  opts: TableOptions = {},
): { latex: string; markdown: string } {
  const keys = opts.keys && opts.keys.length ? opts.keys : unionKeys(rows);
  const caption = opts.caption ?? 'Results.';
  const label = sanitizeRef(opts.label ?? 'results');

  // Single run → transpose to Metric | Value so it reads as a result list.
  if (rows.length === 1) {
    const m = rows[0]!.metrics;
    const header = ['Metric', 'Value'];
    // For LaTeX we escape metric names; markdown keeps them raw.
    const latexBody = keys.map((k) => [escapeLatex(k), cell(m[k])]);
    const mdBody = keys.map((k) => [k, cell(m[k])]);
    return {
      latex: latexTable('lr', header, latexBody, caption, label),
      markdown: markdownTable(header, mdBody),
    };
  }

  const header = ['Run', ...keys];
  const columnSpec = 'l' + 'r'.repeat(keys.length);
  const latexBody = rows.map((r) => [escapeLatex(r.label), ...keys.map((k) => cell(r.metrics[k]))]);
  const mdBody = rows.map((r) => [r.label, ...keys.map((k) => cell(r.metrics[k]))]);
  return {
    latex: latexTable(columnSpec, header, latexBody, caption, label),
    markdown: markdownTable(header, mdBody),
  };
}

/**
 * Like `metricsTable` but appends a cross-run statistics block (mean ± std and
 * 95% CI) below the main table. The optional `baselineLabel` marks that row with
 * "(baseline)" so the reader knows which system to compare against.
 *
 * In LaTeX the stats block is appended as `%`-prefixed comments below the table
 * (copy into a `\\textit{…}` note or a separate tabular as needed).
 * In markdown it renders as a second table.
 */
export function metricsTableWithStats(
  rows: ResultRow[],
  baselineLabel?: string,
  opts: TableOptions = {},
): { latex: string; markdown: string } {
  const displayRows = baselineLabel
    ? rows.map((r) => ({
        ...r,
        label: r.label === baselineLabel ? `${r.label} (baseline)` : r.label,
      }))
    : rows;

  const { latex: baseLatex, markdown: baseMd } = metricsTable(displayRows, opts);
  if (!rows.length) return { latex: baseLatex, markdown: baseMd };

  const keys = opts.keys?.length ? opts.keys : unionKeys(rows);

  const summaries = keys.map((k) => {
    const vals = rows
      .map((r) => r.metrics[k])
      .filter((v): v is number => v !== undefined && Number.isFinite(v));
    return { key: k, s: summarizeMetric(vals, k) };
  });

  const statsMdRows = summaries
    .filter(({ s }) => s.n > 0)
    .map(({ key, s }) => {
      const meanStd =
        s.n > 1 ? `${formatNumber(s.mean)} ± ${formatNumber(s.std)}` : formatNumber(s.mean);
      const ci =
        s.n > 1 ? `[${formatNumber(s.ci95Low)}, ${formatNumber(s.ci95High)}]` : '—';
      return `| ${key} | ${meanStd} | ${ci} |`;
    });

  const statsLatexLines = summaries
    .filter(({ s }) => s.n > 0)
    .map(({ key, s }) => {
      const meanStd =
        s.n > 1 ? `${formatNumber(s.mean)} ± ${formatNumber(s.std)}` : formatNumber(s.mean);
      const ci =
        s.n > 1 ? `[${formatNumber(s.ci95Low)}, ${formatNumber(s.ci95High)}]` : '--';
      return `%   ${key.padEnd(20)}  ${meanStd.padEnd(24)}  CI ${ci}`;
    });

  const latexStats = statsLatexLines.length
    ? '\n% cross-run stats (n=' +
      rows.length +
      '):\n% ' +
      'Metric'.padEnd(20) +
      '  ' +
      'Mean ± Std'.padEnd(24) +
      '  95% CI\n' +
      statsLatexLines.join('\n')
    : '';

  const mdStats =
    statsMdRows.length
      ? '\n\n**Cross-run stats (n=' +
        rows.length +
        '):**\n| Metric | Mean ± Std | 95% CI |\n|---|---|---|\n' +
        statsMdRows.join('\n')
      : '';

  return {
    latex: baseLatex + latexStats,
    markdown: baseMd + mdStats,
  };
}

export interface FigureSpec {
  /** Paper-relative path, e.g. "figures/loss.png". */
  path: string;
  caption?: string;
  label?: string;
  /** Fraction of \linewidth for \includegraphics; default 0.8. */
  widthFraction?: number;
}

/**
 * A LaTeX figure environment (+ markdown image) for one figure. `path` must be
 * relative to the paper folder (the file has to live under paper/ to render on
 * Overleaf). The label defaults to the figure's base filename.
 */
export function figureBlock(fig: FigureSpec): { latex: string; markdown: string } {
  const width = fig.widthFraction ?? 0.8;
  const label = sanitizeRef(fig.label ?? basename(fig.path).replace(/\.[^.]+$/, ''));
  const lines = [
    '\\begin{figure}[t]',
    '\\centering',
    `\\includegraphics[width=${width}\\linewidth]{${fig.path}}`,
  ];
  if (fig.caption) lines.push(`\\caption{${escapeLatex(fig.caption)}}`);
  lines.push(`\\label{fig:${label}}`, '\\end{figure}');
  return {
    latex: lines.join('\n'),
    markdown: `![${fig.caption ?? ''}](${fig.path})`,
  };
}
