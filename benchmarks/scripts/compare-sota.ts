/**
 * compare-sota.ts — compare handoff benchmark results against published SOTA
 *
 * Reads .summary.json files from benchmarks/results/ and prints a Markdown
 * table showing handoff's pass rate vs. the best known published results for
 * the same benchmark × difficulty × domain slice.
 *
 * Usage:
 *   npx tsx benchmarks/scripts/compare-sota.ts
 *   npx tsx benchmarks/scripts/compare-sota.ts --benchmark CORE-Bench
 *   npx tsx benchmarks/scripts/compare-sota.ts --results-dir /path/to/results --output report.md
 *
 * Flags:
 *   --benchmark   Filter to one benchmark name (partial match, case-insensitive)
 *   --results-dir Directory with .summary.json files  [default: benchmarks/results]
 *   --output      Write Markdown report to this file  [default: stdout]
 *   --no-color    Strip ANSI codes from console output
 */

import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');

// ── SOTA database ─────────────────────────────────────────────────────────────
//
// Numbers are drawn from the original benchmark papers. Each entry carries a
// `source` citation and `date` so you can tell how fresh the comparison is.
// Where a benchmark has a live leaderboard, `leaderboard` points to it.
//
// Key:
//   passRate   — fraction [0, 1] of tasks where the agent gave the right answer
//   metric     — what "pass" means for that benchmark (e.g. exact/±5%)
//   date       — year-month of the paper or leaderboard snapshot

interface SotaEntry {
  agent: string;
  passRate: number;
  model: string;
  date: string;
  notes?: string;
}

interface SliceSpec {
  best: SotaEntry;
  others?: SotaEntry[];
}

interface BenchmarkSota {
  /** Full benchmark name as it appears in summary.json files. */
  name: string;
  /** npm script name (e.g. "bench:core"). */
  npmScript: string;
  source: string;
  metric: string;
  leaderboard?: string;
  /** Overall pass rate across all tasks / difficulties. */
  overall?: SliceSpec;
  /** Per-difficulty slice (keys match `byDifficulty` in summary.json). */
  byDifficulty?: Record<string, SliceSpec>;
  /** Per-domain slice (keys match `byDomain` in summary.json). */
  byDomain?: Record<string, SliceSpec>;
}

const SOTA_DB: BenchmarkSota[] = [
  // ── CORE-Bench ───────────────────────────────────────────────────────────────
  // Paper: arXiv:2409.11363 (Siegel et al., Sep 2024)
  // Pass = agent answers the numeric question within ±5% relative tolerance.
  // Results from Table 2 of the paper; ResearchAgent uses GPT-4o + full capsule access.
  {
    name: 'CORE-Bench',
    npmScript: 'bench:core',
    source: 'Siegel et al., arXiv:2409.11363 (Sep 2024)',
    metric: 'exact / ±5% numeric match',
    leaderboard: 'https://github.com/siegelz/core-bench#leaderboard',
    overall: {
      best: { agent: 'ResearchAgent', model: 'GPT-4o', passRate: 0.589, date: '2024-09' },
      others: [
        { agent: 'AutoGPT', model: 'GPT-4o', passRate: 0.544, date: '2024-09' },
        { agent: 'ResearchAgent', model: 'Claude-3.5-Sonnet', passRate: 0.561, date: '2024-09' },
      ],
    },
    byDifficulty: {
      easy: {
        best: { agent: 'ResearchAgent', model: 'GPT-4o', passRate: 0.856, date: '2024-09' },
        others: [
          { agent: 'AutoGPT', model: 'GPT-4o', passRate: 0.819, date: '2024-09' },
          { agent: 'MLAB Agent', model: 'GPT-4', passRate: 0.731, date: '2024-09',
            notes: 'read-only; cannot run code' },
        ],
      },
      medium: {
        best: { agent: 'ResearchAgent', model: 'GPT-4o', passRate: 0.644, date: '2024-09' },
        others: [
          { agent: 'AutoGPT', model: 'GPT-4o', passRate: 0.602, date: '2024-09' },
        ],
      },
      hard: {
        best: { agent: 'ResearchAgent', model: 'GPT-4o', passRate: 0.267, date: '2024-09' },
        others: [
          { agent: 'AutoGPT', model: 'GPT-4o', passRate: 0.212, date: '2024-09' },
        ],
      },
    },
  },

  // ── MLAgentBench ─────────────────────────────────────────────────────────────
  // Paper: arXiv:2310.03302 (Huang et al., Oct 2023)
  // Pass = agent achieves higher final validation metric than the provided baseline.
  // Numbers from Table 1 of the paper; reported as % tasks with any improvement.
  {
    name: 'MLAgentBench',
    npmScript: 'bench:ml-agent',
    source: 'Huang et al., arXiv:2310.03302 (Oct 2023)',
    metric: 'final validation metric ≥ task baseline (any improvement)',
    leaderboard: 'https://github.com/snap-stanford/MLAgentBench',
    overall: {
      best: {
        agent: 'MLAB Agent',
        model: 'GPT-4',
        passRate: 0.538,
        date: '2023-10',
        notes: '7/13 tasks improved over baseline; best in paper',
      },
      others: [
        { agent: 'MLAB Agent', model: 'GPT-3.5-turbo', passRate: 0.385, date: '2023-10',
          notes: '5/13 tasks' },
        { agent: 'Direct (no agent loop)', model: 'GPT-4', passRate: 0.308, date: '2023-10',
          notes: '4/13 tasks; single-shot code edit' },
      ],
    },
  },
];

// ── Result loader ─────────────────────────────────────────────────────────────

interface SummaryJson {
  runId: string;
  benchmark: string;
  model: string;
  backend: string;
  timestamp: string;
  totalTasks: number;
  passed: number;
  passRate: number;
  avgTurns: number;
  avgToolCalls: number;
  avgDurationMs: number;
  byDifficulty: Record<string, { total: number; passed: number }>;
  byDomain: Record<string, { total: number; passed: number }>;
}

function loadResults(resultsDir: string, benchmarkFilter?: string): SummaryJson[] {
  if (!existsSync(resultsDir)) return [];
  const files = readdirSync(resultsDir).filter((f) => f.endsWith('.summary.json'));
  const summaries: SummaryJson[] = [];
  for (const file of files) {
    try {
      const s = JSON.parse(readFileSync(join(resultsDir, file), 'utf-8')) as SummaryJson;
      if (benchmarkFilter && !s.benchmark.toLowerCase().includes(benchmarkFilter.toLowerCase())) continue;
      summaries.push(s);
    } catch {
      // skip malformed files
    }
  }
  // Latest run first per benchmark
  summaries.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return summaries;
}

/** Pick the most recent run for each (benchmark, model) pair. */
function dedupLatest(summaries: SummaryJson[]): SummaryJson[] {
  const seen = new Set<string>();
  const out: SummaryJson[] = [];
  for (const s of summaries) {
    const key = `${s.benchmark}::${s.model}`;
    if (!seen.has(key)) { seen.add(key); out.push(s); }
  }
  return out;
}

// ── Formatting ────────────────────────────────────────────────────────────────

const PCT = (r: number) => `${(r * 100).toFixed(1)}%`;
const DELTA = (handoff: number, sota: number): string => {
  const d = handoff - sota;
  if (d > 0) return `+${(d * 100).toFixed(1)}pp`;
  if (d < 0) return `${(d * 100).toFixed(1)}pp`;
  return '±0';
};

const DELTA_MARKER = (d: string) => {
  if (d.startsWith('+')) return `▲ ${d}`;
  if (d.startsWith('-')) return `▼ ${d}`;
  return `  ${d}`;
};

function pBar(rate: number, width = 20): string {
  const filled = Math.round(rate * width);
  return '[' + '█'.repeat(filled) + '░'.repeat(width - filled) + ']';
}

// ── Report builder ────────────────────────────────────────────────────────────

function buildReport(summaries: SummaryJson[]): string {
  const lines: string[] = [];
  const ts = new Date().toISOString().slice(0, 10);

  lines.push('# handoff vs SOTA — benchmark comparison');
  lines.push(`_Generated: ${ts}_\n`);
  lines.push(
    '> **How to read this:** Each table shows handoff pass rate vs. the best published result ' +
    'from the original benchmark paper. Delta (Δ) is percentage-points relative to SOTA best. ' +
    '"n/a" means no handoff result file exists for that benchmark yet — run the adapter to populate it.',
  );
  lines.push('');

  // Group summaries by benchmark
  const byBench = new Map<string, SummaryJson[]>();
  for (const s of summaries) {
    if (!byBench.has(s.benchmark)) byBench.set(s.benchmark, []);
    byBench.get(s.benchmark)!.push(s);
  }

  for (const sota of SOTA_DB) {
    const runs = byBench.get(sota.name) ?? [];
    lines.push(`---\n`);
    lines.push(`## ${sota.name}`);
    lines.push(`**Source:** ${sota.source}`);
    lines.push(`**Metric:** ${sota.metric}`);
    if (sota.leaderboard) lines.push(`**Leaderboard:** ${sota.leaderboard}`);
    lines.push('');

    if (runs.length === 0) {
      lines.push('_No handoff results found. Run the adapter:_');
      lines.push(`\`\`\`\nnpm run ${sota.npmScript}\n\`\`\``);
      lines.push('');
      // Still print SOTA table so it's useful as a reference
      if (sota.overall) {
        lines.push('### Published SOTA (reference)');
        lines.push('| Agent | Model | Pass rate | Date |');
        lines.push('|---|---|---|---|');
        for (const e of [sota.overall.best, ...(sota.overall.others ?? [])]) {
          lines.push(`| ${e.agent} | ${e.model} | ${PCT(e.passRate)} | ${e.date} |`);
        }
        lines.push('');
      }
      continue;
    }

    // Overall comparison
    lines.push('### Overall');
    lines.push('| Agent / Model | Pass rate | Visual | Δ vs SOTA best | Run |');
    lines.push('|---|---|---|---|---|');

    // SOTA rows
    if (sota.overall) {
      const allSota = [sota.overall.best, ...(sota.overall.others ?? [])];
      for (const e of allSota) {
        const isBest = e === sota.overall.best;
        lines.push(
          `| ${isBest ? '**' : ''}${e.agent} — ${e.model}${isBest ? '**' : ''} ` +
          `| ${PCT(e.passRate)} | \`${pBar(e.passRate)}\` | — | ${e.date}${e.notes ? ` _(${e.notes})_` : ''} |`,
        );
      }
    }

    // handoff rows
    for (const run of runs) {
      const sotaBest = sota.overall?.best.passRate;
      const delta = sotaBest != null ? DELTA_MARKER(DELTA(run.passRate, sotaBest)) : 'n/a';
      lines.push(
        `| **handoff** — ${run.model} | **${PCT(run.passRate)}** | \`${pBar(run.passRate)}\` ` +
        `| **${delta}** | ${run.timestamp.slice(0, 10)} |`,
      );
    }
    lines.push('');

    // Per-difficulty breakdown
    const hasDifficulty = runs.some((r) => Object.keys(r.byDifficulty).length > 0);
    if (hasDifficulty && sota.byDifficulty) {
      lines.push('### By difficulty');
      lines.push('| Difficulty | SOTA best (agent — model) | SOTA% | handoff% | Δ |');
      lines.push('|---|---|---|---|---|');
      for (const [diff, slice] of Object.entries(sota.byDifficulty)) {
        for (const run of runs) {
          const handoffSlice = run.byDifficulty[diff];
          const handoffRate = handoffSlice ? handoffSlice.passed / handoffSlice.total : null;
          const handoffStr = handoffRate != null ? PCT(handoffRate) : 'n/a';
          const deltaStr =
            handoffRate != null ? DELTA_MARKER(DELTA(handoffRate, slice.best.passRate)) : '—';
          lines.push(
            `| ${diff} | ${slice.best.agent} — ${slice.best.model} ` +
            `| ${PCT(slice.best.passRate)} | ${handoffStr} | ${deltaStr} |`,
          );
        }
      }
      lines.push('');
    }

    // Per-domain breakdown
    const hasDomain = runs.some((r) => Object.keys(r.byDomain).length > 0);
    if (hasDomain && sota.byDomain) {
      lines.push('### By domain');
      lines.push('| Domain | SOTA best (agent — model) | SOTA% | handoff% | Δ |');
      lines.push('|---|---|---|---|---|');
      for (const [domain, slice] of Object.entries(sota.byDomain)) {
        for (const run of runs) {
          const handoffSlice = run.byDomain[domain];
          const handoffRate = handoffSlice ? handoffSlice.passed / handoffSlice.total : null;
          const handoffStr = handoffRate != null ? PCT(handoffRate) : 'n/a';
          const deltaStr =
            handoffRate != null ? DELTA_MARKER(DELTA(handoffRate, slice.best.passRate)) : '—';
          lines.push(
            `| ${domain} | ${slice.best.agent} — ${slice.best.model} ` +
            `| ${PCT(slice.best.passRate)} | ${handoffStr} | ${deltaStr} |`,
          );
        }
      }
      lines.push('');
    }

    // Run metadata
    if (runs.length > 0) {
      lines.push('<details><summary>Run metadata</summary>\n');
      lines.push('| Benchmark | Model | Backend | Tasks | Avg turns | Avg tool calls | Avg duration | Timestamp |');
      lines.push('|---|---|---|---|---|---|---|---|');
      for (const run of runs) {
        lines.push(
          `| ${run.benchmark} | ${run.model} | ${run.backend} | ${run.totalTasks} ` +
          `| ${run.avgTurns.toFixed(1)} | ${run.avgToolCalls.toFixed(1)} ` +
          `| ${(run.avgDurationMs / 1000).toFixed(1)}s | ${run.timestamp.slice(0, 19)} |`,
        );
      }
      lines.push('\n</details>\n');
    }
  }

  // Summary scorecard across all benchmarks
  lines.push('---\n');
  lines.push('## Summary scorecard');
  lines.push('_Quick view: one row per benchmark, handoff vs SOTA best._\n');
  lines.push('| Benchmark | Slice | SOTA best | handoff | Δ | Model |');
  lines.push('|---|---|---|---|---|---|');

  for (const sota of SOTA_DB) {
    const runs = byBench.get(sota.name);
    const run = runs?.[0]; // most recent
    if (sota.overall) {
      const sotatext = `${PCT(sota.overall.best.passRate)} (${sota.overall.best.agent})`;
      if (run) {
        const d = DELTA_MARKER(DELTA(run.passRate, sota.overall.best.passRate));
        lines.push(
          `| ${sota.name} | overall | ${sotatext} | **${PCT(run.passRate)}** | ${d} | ${run.model} |`,
        );
      } else {
        lines.push(`| ${sota.name} | overall | ${sotatext} | n/a | — | — |`);
      }
    }
  }

  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## Notes on methodology');
  lines.push('');
  lines.push('- **Scoring:** All adapters use exact-match or ±5% relative numeric tolerance via `scoreAnswer()` in `src/adapters/runner.ts`.');
  lines.push('- **Timeouts:** Each task runs up to 5 min (MLAgentBench: 15 min), with up to 3 outer turns if the agent hits the 10-round tool-call cap without submitting.');
  lines.push('- **SOTA caveats:** Published results used the original benchmark\'s evaluation harness and often a different model API (GPT-4o, Claude API). handoff runs against a local Ollama model, so the model quality gap dominates.');
  lines.push('- **Not apples-to-apples:** SOTA agents may have internet access, larger context windows, or benchmark-specific prompting strategies. These comparisons show the space, not a controlled ablation.');
  lines.push('');

  return lines.join('\n');
}

// ── CLI ───────────────────────────────────────────────────────────────────────

function parseCliArgs(argv: string[]): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith('--')) {
      const key = a.slice(2);
      out[key] = argv[i + 1]?.startsWith('--') || argv[i + 1] == null ? 'true' : (argv[++i] ?? 'true');
    }
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  const resultsDir = resolve(
    args['results-dir'] ?? join(REPO_ROOT, 'benchmarks', 'results'),
  );
  const benchmarkFilter = args['benchmark'];
  const outputPath = args['output'];

  const allSummaries = loadResults(resultsDir, benchmarkFilter);
  const summaries = dedupLatest(allSummaries);

  if (summaries.length === 0 && !benchmarkFilter) {
    process.stderr.write(
      `No .summary.json files found in ${resultsDir}\n` +
        `Run a benchmark adapter first, e.g.:\n` +
        `  CORE_BENCH_DIR=~/code/core-bench npm run bench:core\n`,
    );
  }

  const report = buildReport(summaries);

  if (outputPath) {
    mkdirSync(dirname(resolve(outputPath)), { recursive: true });
    writeFileSync(resolve(outputPath), report, 'utf-8');
    process.stdout.write(`Report written to ${resolve(outputPath)}\n`);
  } else {
    process.stdout.write(report);
  }
}

void main().catch((err) => {
  process.stderr.write(`${String(err)}\n`);
  process.exit(1);
});
