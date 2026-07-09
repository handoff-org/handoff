import { existsSync, mkdirSync, writeFileSync, copyFileSync } from 'fs';
import { join, basename } from 'path';
import type { ToolRegistry } from '../tools/registry.js';
import { getActiveProject, projectPaths } from './project.js';
import { listCapsules, readCapsule, getPromoted, type Capsule } from './capsule.js';
import { mainTexFile } from './overleaf.js';
import { appendNotebook } from '../research/notebook.js';
import { metricsTable, figureBlock, isFigureFile, sanitizeRef } from './resultsTable.js';
import { checkProvenance, applyProvenanceVerdicts, formatProvenanceReport } from './provenance.js';

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
}
