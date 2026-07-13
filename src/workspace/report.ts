import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'fs';
import { join, basename } from 'path';
import type { ToolRegistry } from '../tools/registry.js';
import { getActiveProject, projectPaths } from './project.js';
import { listCapsules, readCapsule, getPromoted, type Capsule } from './capsule.js';
import { mainTexFile } from './overleaf.js';
import { appendNotebook } from '../research/notebook.js';
import { metricsTable, figureBlock, isFigureFile, sanitizeRef } from './resultsTable.js';
import {
  checkProvenance,
  applyProvenanceVerdicts,
  formatProvenanceReport,
  extractNumbers,
  numbersMatch,
} from './provenance.js';
import {
  checkProse,
  formatWritingReport,
  scaffoldSections,
  buildLitReviewContext,
} from '../research/prose.js';
import { findTexFiles } from './auditor.js';
import {
  readBindings,
  appendBinding,
  newBindingId,
  formatBindingsSummary,
  type MetricBinding,
} from './bindings.js';
import {
  summarizeMetric,
  compareMetrics,
  formatStatsSummary,
  formatComparisonStats,
  statsLatexSnippet,
} from './statsReport.js';
import { readClaims, updateClaim, type Claim } from './claims.js';

/**
 * Resolve a `runs` spec into capsules (oldest first). Accepts explicit space/
 * comma-separated ids, or the keywords `promoted` / `all` / `latest`. With no
 * spec, defaults to the promoted (canonical) runs, or the latest run if none
 * are promoted. Also returns the promoted-id set for row badging.
 */
function resolveRuns(slug: string, spec?: string): { capsules: Capsule[]; promoted: Set<string> } {
  const all = listCapsules(slug); // oldest → newest
  const promoted = new Set(getPromoted(slug));
  const s = (spec ?? '').trim().toLowerCase();

  if (!s) {
    const prom = all.filter((c) => promoted.has(c.id));
    return { capsules: prom.length ? prom : all.slice(-1), promoted };
  }
  if (s === 'promoted') return { capsules: all.filter((c) => promoted.has(c.id)), promoted };
  if (s === 'all') return { capsules: all, promoted };
  if (s === 'latest') return { capsules: all.slice(-1), promoted };

  const ids = spec!.split(/[\s,]+/).filter(Boolean);
  const capsules = ids.map((id) => readCapsule(slug, id)).filter((c): c is Capsule => c !== null);
  return { capsules, promoted };
}

/** Register the results-reporting tools (turn runs into paper-ready artifacts). */
export function registerReportTools(registry: ToolRegistry): void {
  registry.register({
    name: 'export_results',
    description:
      'Turn one or more experiment runs into a paper-ready results table (LaTeX booktabs + ' +
      'markdown) built straight from the captured metrics — never retyped. Also emits ' +
      '\\includegraphics figure blocks for any figures the runs saved under results/, and ' +
      'copies those figure files into paper/figures/ so they render on Overleaf. Saves a ' +
      'durable copy under results/tables/ and returns the LaTeX to insert into main.tex with ' +
      'edit_file. Pick runs with `runs` (ids, or "promoted"/"all"/"latest"; default: promoted ' +
      'runs, else the latest). Requires an initialized paper for figures (run start_paper).',
    sensitive: true,
    parameters: {
      type: 'object',
      properties: {
        runs: {
          type: 'string',
          description:
            'Run ids (space/comma separated), or "promoted" / "all" / "latest". ' +
            'Default: promoted runs, else the latest run.',
        },
        metrics: {
          type: 'string',
          description:
            'Metric names to include as columns, in order (space/comma separated). ' +
            'Default: every metric across the selected runs.',
        },
        caption: { type: 'string', description: 'Table caption (default "Results.")' },
        label: {
          type: 'string',
          description:
            'Base for \\label{tab:…} and the saved artifact filename (default "results")',
        },
        figures: {
          type: 'string',
          enum: ['auto', 'none'],
          description: 'auto (default) = include figures from the runs; none = table only',
        },
      },
    },
    async execute({ runs, metrics, caption, label, figures }) {
      const meta = getActiveProject();
      if (!meta) return 'No active project. Create one and run code (run_code) before exporting.';
      const slug = meta.slug;

      const { capsules, promoted } = resolveRuns(slug, runs ? String(runs) : undefined);
      if (capsules.length === 0) {
        return (
          'No matching runs to export. Produce a run with run_code (record metrics via ' +
          'results/metrics.json or "METRIC name=value" lines), or pass explicit run ids.'
        );
      }

      // Build the metrics table.
      const keys = metrics
        ? String(metrics)
            .split(/[\s,]+/)
            .filter(Boolean)
        : undefined;
      const rows = capsules.map((c) => ({
        label: promoted.has(c.id) ? `${c.id} (★)` : c.id,
        metrics: c.metrics,
      }));
      const table = metricsTable(rows, {
        ...(keys && keys.length ? { keys } : {}),
        ...(caption ? { caption: String(caption) } : {}),
        ...(label ? { label: String(label) } : {}),
      });

      // Collect figure outputs; copy them into paper/figures/ so they render.
      const paperDir = projectPaths(slug).paper;
      const resultsDir = projectPaths(slug).results;
      const paperReady = mainTexFile(paperDir) !== null;
      const wantFigures = String(figures ?? 'auto').toLowerCase() !== 'none';

      const figBlocks: string[] = [];
      const copied: string[] = [];
      const skippedNoPaper: string[] = [];
      if (wantFigures) {
        const figPaths = new Set<string>();
        for (const c of capsules) {
          for (const p of Object.keys(c.outputHashes)) if (isFigureFile(p)) figPaths.add(p);
        }
        for (const rel of [...figPaths].sort()) {
          const src = join(resultsDir, rel);
          if (!existsSync(src)) continue; // recorded but since removed
          if (!paperReady) {
            skippedNoPaper.push(rel);
            continue;
          }
          const base = basename(rel);
          mkdirSync(join(paperDir, 'figures'), { recursive: true });
          copyFileSync(src, join(paperDir, 'figures', base));
          const paperRel = `figures/${base}`;
          copied.push(paperRel);
          const stem = base.replace(/\.[^.]+$/, '');
          figBlocks.push(figureBlock({ path: paperRel, caption: stem, label: stem }).latex);
        }
      }

      // Save a durable artifact under results/tables/.
      const name = sanitizeRef(label ? String(label) : 'results');
      const tablesDir = join(resultsDir, 'tables');
      mkdirSync(tablesDir, { recursive: true });
      const latexAll = [table.latex, ...figBlocks].join('\n\n');
      writeFileSync(join(tablesDir, `${name}.tex`), latexAll + '\n', 'utf-8');
      writeFileSync(join(tablesDir, `${name}.md`), table.markdown + '\n', 'utf-8');

      appendNotebook(slug, {
        type: 'note',
        summary:
          `Exported results (${rows.length} run${rows.length === 1 ? '' : 's'}` +
          `${copied.length ? `, ${copied.length} figure(s)` : ''}) → results/tables/${name}.tex`,
      });

      // Assemble the response.
      const out: string[] = [
        `Results table for ${rows.length} run${rows.length === 1 ? '' : 's'}: ${rows
          .map((r) => r.label)
          .join(', ')}.`,
      ];
      if (copied.length)
        out.push(`Copied ${copied.length} figure(s) into paper/: ${copied.join(', ')}.`);
      if (skippedNoPaper.length) {
        out.push(
          `Skipped ${skippedNoPaper.length} figure(s) — run start_paper, then export_results again ` +
            `to include: ${skippedNoPaper.join(', ')}.`,
        );
      }
      out.push(
        `Saved artifact: results/tables/${name}.tex (+ .md).`,
        '',
        'Insert into main.tex with edit_file:',
        '',
        latexAll,
        '',
        'Markdown version:',
        '',
        table.markdown,
      );
      return out.join('\n');
    },
  });

  registry.register({
    name: 'check_provenance',
    description:
      'Verify that the numbers written in the paper still match the runs that produced them. ' +
      'For every claim linked to a run (see /claim-link-run), it compares the numbers in the ' +
      "claim text against that run's current captured metrics, marks any mismatch as " +
      '"outdated" with a concrete note (paper 0.92 → run reports 0.89), and recovers a claim ' +
      'if its number now matches again. Run this after /rerun or before a handoff. Operates on ' +
      'the active project; takes no arguments.',
    sensitive: true,
    parameters: { type: 'object', properties: {} },
    async execute() {
      const meta = getActiveProject();
      if (!meta) return 'No active project.';
      const verdicts = checkProvenance(meta.slug);
      applyProvenanceVerdicts(meta.slug, verdicts);
      return formatProvenanceReport(verdicts, meta.title);
    },
  });

  registry.register({
    name: 'check_writing',
    description:
      'Run local writing-quality checks over the paper (paper/*.tex): hedge/weasel words, ' +
      'passive-voice hints, doubled words, leftover TODO/FIXME markers, dangling \\ref (no ' +
      'matching \\label), and \\cite keys missing from refs.bib. Read-only — it reports issues ' +
      'for you to fix, never edits. Complements /audit-paper (unsupported claims) and ' +
      'check_provenance (stale numbers). Operates on the active project; takes no arguments.',
    parameters: { type: 'object', properties: {} },
    async execute() {
      const meta = getActiveProject();
      if (!meta) return 'No active project.';
      return formatWritingReport(checkProse(meta.slug), meta.title);
    },
  });

  registry.register({
    name: 'scaffold_sections',
    description:
      'Return a standard section skeleton (Introduction, Related Work, Method, Experiments, ' +
      'Results, Conclusion — each with a \\label and a TODO) to drop into main.tex before ' +
      '\\end{document}. Use kind="empirical" for a fuller empirical-paper structure. Returns ' +
      'the LaTeX; insert it with edit_file (it does not modify the paper itself).',
    parameters: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          enum: ['default', 'empirical'],
          description: 'default (6 sections) or empirical (adds Experimental Setup + Discussion)',
        },
      },
    },
    async execute({ kind }) {
      return scaffoldSections(kind === 'empirical' ? 'empirical' : 'default');
    },
  });

  // ── Metric/figure bindings ───────────────────────────────────────────────────

  registry.register({
    name: 'bind_metric',
    description:
      'Bind a specific number in the paper to the run and metric that produced it. ' +
      'Creates a confirmed MetricBinding (confidence=1.0) linking file+line+raw value to a ' +
      'run capsule and metric key. Use after auto_link_number to confirm a suggestion, or ' +
      'directly when you know exactly where a number came from. ' +
      'Optionally link to a claim id to upgrade its status to weakly_supported.',
    sensitive: true,
    parameters: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          description: 'Paper-relative path, e.g. "paper/main.tex"',
        },
        line: { type: 'string', description: 'Line number (1-based)' },
        raw: {
          type: 'string',
          description: 'The number exactly as written in the paper, e.g. "92.1"',
        },
        run_id: { type: 'string', description: 'Run capsule id that produced this value' },
        metric_key: { type: 'string', description: 'Metric key from the capsule, e.g. "accuracy"' },
        claim_id: {
          type: 'string',
          description: 'Optional claim id to link — upgrades its status to weakly_supported',
        },
      },
      required: ['file', 'line', 'raw', 'run_id', 'metric_key'],
    },
    async execute({ file, line, raw, run_id, metric_key, claim_id }) {
      const meta = getActiveProject();
      if (!meta) return 'No active project.';

      const capsule = readCapsule(meta.slug, String(run_id));
      if (!capsule) return `Run "${run_id}" not found. Check the id with query_runs.`;

      const key = String(metric_key);
      if (!(key in capsule.metrics)) {
        const available = Object.keys(capsule.metrics).join(', ');
        return `Metric "${key}" not in run ${run_id}. Available: ${available || '(none)'}`;
      }

      const binding: MetricBinding = {
        id: newBindingId(),
        file: String(file),
        line: Number(line) || 0,
        raw: String(raw),
        value: capsule.metrics[key]!,
        runId: String(run_id),
        metricKey: key,
        ...(claim_id ? { claimId: String(claim_id) } : {}),
        confidence: 1.0,
        boundAt: new Date().toISOString(),
      };
      appendBinding(meta.slug, binding);

      if (claim_id) {
        updateClaim(meta.slug, String(claim_id), { status: 'weakly_supported' });
      }

      return (
        `Bound ${binding.raw} at ${binding.file}:${binding.line} → run ${binding.runId} metric ${binding.metricKey} = ${binding.value}\n` +
        `Binding id: ${binding.id}`
      );
    },
  });

  registry.register({
    name: 'list_bindings',
    description:
      'List all metric bindings for the active project. Each row shows the binding id, ' +
      'file:line, the raw value as written, run id, and metric key. ' +
      'Confirmed bindings (confidence=1) are marked ✓; auto-suggested ones show their confidence.',
    parameters: { type: 'object', properties: {} },
    async execute() {
      const meta = getActiveProject();
      if (!meta) return 'No active project.';
      return formatBindingsSummary(readBindings(meta.slug), meta.title);
    },
  });

  // ── Stats reporting ──────────────────────────────────────────────────────────

  registry.register({
    name: 'compute_stats',
    description:
      'Compute descriptive statistics (mean, std, 95% CI) and optionally a pairwise comparison ' +
      "(Cohen's d, % diff, effect size) for a metric across runs. " +
      'Run ids: space/comma-separated ids, or "promoted"/"all"/"latest". ' +
      'With baseline_run_ids, compares treatment runs against those baseline runs. ' +
      'Also returns a ready-to-paste LaTeX snippet for the paper.',
    parameters: {
      type: 'object',
      properties: {
        run_ids: {
          type: 'string',
          description: 'Treatment run ids (space/comma-separated, or "promoted"/"all"/"latest")',
        },
        metric: { type: 'string', description: 'Metric key to analyze, e.g. "accuracy"' },
        baseline_run_ids: {
          type: 'string',
          description: 'Optional baseline run ids for pairwise comparison',
        },
        is_percent: {
          type: 'string',
          description: 'Set "true" if the metric is a percentage (adds \\% to the LaTeX snippet)',
        },
      },
      required: ['run_ids', 'metric'],
    },
    async execute({ run_ids, metric, baseline_run_ids, is_percent }) {
      const meta = getActiveProject();
      if (!meta) return 'No active project.';

      const { capsules: treatCapsules } = resolveRuns(meta.slug, String(run_ids));
      if (treatCapsules.length === 0) return 'No runs found for the given run_ids.';

      const key = String(metric);
      const treatVals = treatCapsules
        .map((c) => c.metrics[key])
        .filter((v): v is number => v !== undefined && Number.isFinite(v));

      if (treatVals.length === 0) return `Metric "${key}" not found in any of the selected runs.`;

      const summary = summarizeMetric(treatVals, key);
      const pct = is_percent === 'true' || is_percent === true;
      const parts: string[] = [
        formatStatsSummary(summary),
        '',
        'LaTeX snippet:',
        statsLatexSnippet(summary, pct),
      ];

      if (baseline_run_ids) {
        const { capsules: baseCapsules } = resolveRuns(meta.slug, String(baseline_run_ids));
        const baseVals = baseCapsules
          .map((c) => c.metrics[key])
          .filter((v): v is number => v !== undefined && Number.isFinite(v));

        if (baseVals.length > 0) {
          const comp = compareMetrics(treatVals, baseVals, key);
          parts.push('', 'Comparison vs baseline:', formatComparisonStats(comp));
        }
      }

      return parts.join('\n');
    },
  });

  // ── Auto-link unlinked numbers ───────────────────────────────────────────────

  registry.register({
    name: 'auto_link_number',
    description:
      'Scan the paper for numeric values that are not yet bound to a run metric, then ' +
      'suggest which run and metric key each might have come from. ' +
      'Suggestions are ranked by how closely the capsule value matches the paper value. ' +
      'Confirm a suggestion with bind_metric.',
    parameters: { type: 'object', properties: {} },
    async execute() {
      const meta = getActiveProject();
      if (!meta) return 'No active project.';

      const paperDir = projectPaths(meta.slug).paper;
      const texFiles = findTexFiles(paperDir);
      if (!texFiles.length) return 'No .tex files found in paper/. Add your LaTeX and retry.';

      const existingBindings = readBindings(meta.slug);
      const boundKeys = new Set(existingBindings.map((b) => `${b.file}:${b.line}:${b.raw}`));

      // Collect all numbers from tex files that aren't already bound.
      const candidates: { file: string; line: number; raw: string; value: number }[] = [];
      for (const filePath of texFiles) {
        let content: string;
        try {
          content = readFileSync(filePath, 'utf-8');
        } catch {
          continue;
        }
        const relFile = filePath.replace(projectPaths(meta.slug).root + '/', '');
        const lines = content.split('\n');
        lines.forEach((lineText, i) => {
          const lineNum = i + 1;
          const nums = extractNumbers(lineText);
          for (const { raw, value } of nums) {
            const key = `${relFile}:${lineNum}:${raw}`;
            if (!boundKeys.has(key)) {
              candidates.push({ file: relFile, line: lineNum, raw, value });
            }
          }
        });
      }

      if (!candidates.length) return 'All numeric values in the paper are already bound.';

      // Build a map of runId → metric → value from all capsules.
      const capsules = listCapsules(meta.slug);
      if (!capsules.length) return 'No runs yet. Run code and record metrics before auto-linking.';

      type Suggestion = {
        file: string;
        line: number;
        raw: string;
        runId: string;
        metricKey: string;
        runValue: number;
        confidence: number;
      };
      const suggestions: Suggestion[] = [];

      for (const c of candidates.slice(0, 50)) {
        const best: Suggestion[] = [];
        for (const cap of capsules) {
          for (const [mk, mv] of Object.entries(cap.metrics)) {
            if (numbersMatch(c.value, mv)) {
              // Confidence: exact match = 1.0; near match proportional to closeness.
              const relDiff = Math.abs(c.value - mv) / (Math.abs(mv) || 1);
              const conf = Math.max(0.5, 1 - relDiff * 10);
              best.push({
                file: c.file,
                line: c.line,
                raw: c.raw,
                runId: cap.id,
                metricKey: mk,
                runValue: mv,
                confidence: conf,
              });
            }
          }
        }
        if (best.length) {
          best.sort((a, b) => b.confidence - a.confidence);
          suggestions.push(best[0]!);
        }
      }

      if (!suggestions.length) {
        return (
          `Found ${candidates.length} unbound number${candidates.length !== 1 ? 's' : ''} ` +
          `but none matched any capsule metric within 1%. ` +
          `Check metric keys with query_runs or export_results.`
        );
      }

      const rows = suggestions.map((s) => {
        const conf = s.confidence >= 0.99 ? '✓ exact' : `~${Math.round(s.confidence * 100)}%`;
        return `  ${conf.padEnd(10)}  ${s.file}:${s.line}  ${s.raw.padEnd(10)}  → ${s.runId}  ${s.metricKey}=${s.runValue}`;
      });

      return [
        `${suggestions.length} auto-link suggestion${suggestions.length !== 1 ? 's' : ''} (${candidates.length} unbound values scanned):`,
        '',
        '  Conf        File:Line  Paper value  Suggested binding',
        '  ' + '─'.repeat(74),
        ...rows,
        '',
        'Confirm with: bind_metric --file <file> --line <line> --raw <raw> --run_id <id> --metric_key <key>',
      ].join('\n');
    },
  });

  // ── Section co-writing ───────────────────────────────────────────────────────

  registry.register({
    name: 'draft_section',
    description:
      'Build a structured context block and LaTeX skeleton for drafting one paper section. ' +
      'Gathers section-appropriate evidence: lit notes for Related Work; run metrics and stats ' +
      'for Experiments/Results; claims by type for other sections. ' +
      'Returns the context + skeleton with %TODO markers — use it to write the section, ' +
      'then insert with edit_file.',
    parameters: {
      type: 'object',
      properties: {
        section: {
          type: 'string',
          enum: ['introduction', 'related_work', 'method', 'experiments', 'results', 'conclusion'],
          description: 'Which section to draft context for',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Filter lit notes by tag (related_work only)',
        },
      },
      required: ['section'],
    },
    async execute({ section, tags }) {
      const meta = getActiveProject();
      if (!meta) return 'No active project.';

      const sec = String(section ?? 'introduction').toLowerCase();
      const parts: string[] = [];

      if (sec === 'related_work') {
        const ctx = buildLitReviewContext(
          meta.slug,
          Array.isArray(tags) ? tags.map(String) : undefined,
        );
        parts.push('=== Evidence: Literature ===', ctx);

        const skeleton = [
          '\\section{Related Work}',
          '\\label{sec:related-work}',
          '',
          '% TODO: Synthesize the notes below into a narrative.',
          '% Group papers by theme; cite with \\cite{key} after running cite_paper.',
          '',
        ].join('\n');
        parts.push('', '=== LaTeX Skeleton ===', skeleton);
      } else if (sec === 'experiments' || sec === 'results') {
        const { capsules: promoted } = resolveRuns(meta.slug, 'promoted');
        const capsulesToShow = promoted.length ? promoted : listCapsules(meta.slug).slice(-3);

        if (capsulesToShow.length) {
          parts.push('=== Evidence: Run Metrics ===');
          for (const c of capsulesToShow) {
            const metricStr = Object.entries(c.metrics)
              .map(([k, v]) => `${k}=${v}`)
              .join(', ');
            parts.push(`  ${c.id}  ${metricStr || '(no metrics)'}`);
          }

          // Stats summaries per shared metric.
          const allKeys = new Set<string>();
          for (const c of capsulesToShow) for (const k of Object.keys(c.metrics)) allKeys.add(k);
          if (allKeys.size) {
            parts.push('', '=== Stats (per metric, across runs) ===');
            for (const k of allKeys) {
              const vals = capsulesToShow
                .map((c) => c.metrics[k])
                .filter((v): v is number => v !== undefined && Number.isFinite(v));
              if (vals.length) {
                const s = summarizeMetric(vals, k);
                parts.push(formatStatsSummary(s));
              }
            }
          }
        }

        const label = sec === 'experiments' ? 'Experimental Setup' : 'Results';
        const skeleton = [
          `\\section{${label}}`,
          `\\label{sec:${sec}}`,
          '',
          '% TODO: Describe the setup and report numbers below.',
          '% Insert the results table from export_results.',
          '',
        ].join('\n');
        parts.push('', '=== LaTeX Skeleton ===', skeleton);
      } else {
        // Introduction, method, conclusion — draw from claims.
        const claims = readClaims(meta.slug);
        const typeMap: Record<string, string[]> = {
          introduction: ['contribution_claim', 'empirical_result'],
          method: ['method_claim'],
          conclusion: ['contribution_claim', 'limitation_claim', 'future_work_claim'],
        };
        const relevantTypes = typeMap[sec] ?? [];
        const relevant = claims.filter((c: Claim) => relevantTypes.includes(c.type));

        if (relevant.length) {
          parts.push(
            `=== Evidence: ${relevant.length} claim${relevant.length !== 1 ? 's' : ''} ===`,
          );
          for (const c of relevant) {
            const icon =
              c.status === 'supported' ? '✓' : c.status === 'weakly_supported' ? '~' : '?';
            parts.push(
              `  ${icon} [${c.type}] ${c.text.slice(0, 120)}${c.text.length > 120 ? '…' : ''}`,
            );
          }
        }

        const labelMap: Record<string, string> = {
          introduction: 'Introduction',
          method: 'Method',
          conclusion: 'Conclusion',
        };
        const title = labelMap[sec] ?? sec.charAt(0).toUpperCase() + sec.slice(1);
        const skeleton = [
          `\\section{${title}}`,
          `\\label{sec:${sec}}`,
          '',
          `% TODO: Draft the ${title} drawing on the claims above.`,
          '',
        ].join('\n');
        parts.push('', '=== LaTeX Skeleton ===', skeleton);
      }

      appendNotebook(meta.slug, {
        type: 'draft-section',
        summary: `Gathered context for ${sec} section.`,
      });

      return parts.join('\n\n');
    },
  });

  // ── Lit-review synthesis ─────────────────────────────────────────────────────

  registry.register({
    name: 'draft_lit_review',
    description:
      'Build the full context block for drafting a Related Work section. ' +
      'Combines structured lit notes (optionally filtered by tag) with notebook literature-find ' +
      'entries. Returns the evidence block + a LaTeX skeleton. ' +
      'Use the context to write the section, then insert with edit_file.',
    parameters: {
      type: 'object',
      properties: {
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Only include notes with these tags (default: all notes)',
        },
        max_words: {
          type: 'string',
          description:
            'Approximate target word count for the section (informational hint, default 400)',
        },
      },
    },
    async execute({ tags, max_words }) {
      const meta = getActiveProject();
      if (!meta) return 'No active project.';

      const ctx = buildLitReviewContext(
        meta.slug,
        Array.isArray(tags) ? tags.map(String) : undefined,
      );
      const words = max_words ? Number(max_words) || 400 : 400;

      const skeleton = [
        '\\section{Related Work}',
        '\\label{sec:related-work}',
        '',
        `% TODO: ~${words} words. Group papers by theme; use \\cite{key}.`,
        '% Draw on the notes below; only include papers relevant to this project.',
        '',
      ].join('\n');

      return [
        `=== Literature Context (${meta.title}) ===`,
        '',
        ctx,
        '',
        '=== LaTeX Skeleton ===',
        skeleton,
      ].join('\n');
    },
  });

  // ── Comparison-claim verification ────────────────────────────────────────────

  registry.register({
    name: 'verify_comparison',
    description:
      'Check comparison claims ("A outperforms B by X%") against the actual run data. ' +
      'For claims with ≥2 run-linked evidences, loads the capsules, compares the shared ' +
      'metric, and reports HOLDS or FAILS with the actual values. ' +
      'Claims with no run links are marked UNVERIFIED.',
    parameters: { type: 'object', properties: {} },
    async execute() {
      const meta = getActiveProject();
      if (!meta) return 'No active project.';

      const allClaims = readClaims(meta.slug);
      const comparisons = allClaims.filter((c: Claim) => c.type === 'comparison_claim');

      if (!comparisons.length) {
        return 'No comparison claims found. Add claims of type comparison_claim first.';
      }

      const lines: string[] = [
        `Comparison claim verification — ${meta.title}`,
        '',
        `${comparisons.length} comparison claim${comparisons.length !== 1 ? 's' : ''}:`,
        '─'.repeat(72),
      ];

      for (const claim of comparisons) {
        const runLinks = claim.evidence.filter((e) => e.kind === 'run');

        if (runLinks.length < 2) {
          lines.push(
            `UNVERIFIED  ${claim.id}`,
            `  "${claim.text.slice(0, 100)}${claim.text.length > 100 ? '…' : ''}"`,
            `  (${runLinks.length} run link${runLinks.length !== 1 ? 's' : ''} — need ≥2 to verify. Use claim-link-run.)`,
            '',
          );
          continue;
        }

        const capA = readCapsule(meta.slug, runLinks[0]!.ref);
        const capB = readCapsule(meta.slug, runLinks[1]!.ref);

        if (!capA || !capB) {
          lines.push(
            `UNVERIFIED  ${claim.id}`,
            `  "${claim.text.slice(0, 100)}…"`,
            `  (capsule not found for one or both linked runs)`,
            '',
          );
          continue;
        }

        const sharedKeys = Object.keys(capA.metrics).filter((k) => k in capB.metrics);

        if (!sharedKeys.length) {
          lines.push(
            `UNVERIFIED  ${claim.id}`,
            `  "${claim.text.slice(0, 100)}…"`,
            `  (runs ${capA.id} and ${capB.id} share no common metrics)`,
            '',
          );
          continue;
        }

        // Find the most mentioned metric key in the claim text.
        const bestKey =
          sharedKeys.find((k) => claim.text.toLowerCase().includes(k.toLowerCase())) ??
          sharedKeys[0]!;

        const vA = capA.metrics[bestKey]!;
        const vB = capB.metrics[bestKey]!;
        const holds = vA > vB;
        const delta = ((vA - vB) / (Math.abs(vB) || 1)) * 100;
        const verdict = holds ? 'HOLDS  ✓' : 'FAILS  ✗';

        lines.push(
          `${verdict}  ${claim.id}`,
          `  "${claim.text.slice(0, 100)}${claim.text.length > 100 ? '…' : ''}"`,
          `  metric: ${bestKey}  |  run A (${capA.id}): ${vA}  vs  run B (${capB.id}): ${vB}  |  Δ = ${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%`,
          '',
        );
      }

      return lines.join('\n');
    },
  });
}
