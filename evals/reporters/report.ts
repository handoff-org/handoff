import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { redactSecrets } from '../../src/util/redact.js';
import type { ScenarioResult, Severity, Taxonomy } from '../schema/types.js';
import type { RunMeta, EnvironmentInfo } from './env.js';

/** Where a failure most likely needs to be fixed — drives FAILURE_BACKLOG grouping. */
export const REMEDIATION_AREA: Partial<Record<Taxonomy, string>> = {
  MODEL_REASONING: 'model selection',
  MODEL_INSTRUCTION_FOLLOWING: 'system prompt',
  MODEL_HALLUCINATION: 'model selection',
  MODEL_UNCERTAINTY: 'system prompt',
  MODEL_LONG_CONTEXT: 'compaction',
  MODEL_WRITING: 'system prompt',
  MODEL_FORMATTING: 'system prompt',
  CITATION_FABRICATION: 'citation representation',
  CITATION_MISMATCH: 'citation representation',
  EVIDENCE_MISINTERPRETATION: 'retrieval',
  NUMERICAL_ERROR: 'tool definitions',
  TOOL_SELECTION: 'tool definitions',
  TOOL_ARGUMENT: 'tool definitions',
  TOOL_RESULT_INTERPRETATION: 'context assembly',
  TOOL_RECOVERY: 'tool implementations',
  PROMPT_ASSEMBLY: 'context assembly',
  CONTEXT_RETRIEVAL: 'retrieval',
  CONTEXT_COMPACTION: 'compaction',
  PROJECT_MEMORY: 'context assembly',
  PRIVACY_LEAK: 'privacy filters',
  PROMPT_INJECTION: 'system prompt',
  UNAPPROVED_NETWORK_ACCESS: 'privacy filters',
  SECRET_REDACTION: 'privacy filters',
  STREAMING_CORRUPTION: 'streaming',
  UI_PRESENTATION: 'prompt box/UI',
  RELAY_TRANSPORT: 'relay',
  PROVIDER_FAILURE: 'relay',
  PERFORMANCE_REGRESSION: 'performance',
  TEST_HARNESS: 'evaluation harness',
  FLAKY_SCENARIO: 'evaluation harness',
  JUDGE_ERROR: 'evaluation harness',
  FIXTURE_ERROR: 'evaluation harness',
};

const SEV_RANK: Record<Severity, number> = { critical: 3, high: 2, medium: 1, low: 0 };

export interface Aggregate {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  passRate: number;
  hardGateFailures: number;
  bySeverity: Record<string, number>;
  byCategory: Record<string, { total: number; passed: number }>;
  byDifficulty: Record<string, { total: number; passed: number }>;
  byLayer: Record<string, { total: number; passed: number }>;
  latency: { p50: number; p95: number; max: number };
  tokens: { totalOutput: number };
  flaky: string[];
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return Math.round(sorted[idx]!);
}

export function aggregate(results: ScenarioResult[]): Aggregate {
  const scored = results.filter((r) => !r.skipped);
  const bySeverity: Record<string, number> = {};
  const byCategory: Aggregate['byCategory'] = {};
  const byDifficulty: Aggregate['byDifficulty'] = {};
  const byLayer: Aggregate['byLayer'] = {};
  const bump = (m: Record<string, { total: number; passed: number }>, k: string, ok: boolean) => {
    m[k] ??= { total: 0, passed: 0 };
    m[k].total++;
    if (ok) m[k].passed++;
  };
  for (const r of scored) {
    if (!r.passed && r.severity) bySeverity[r.severity] = (bySeverity[r.severity] ?? 0) + 1;
    bump(byCategory, r.category, r.passed);
    bump(byDifficulty, r.difficulty, r.passed);
    bump(byLayer, r.layer, r.passed);
  }
  // Flaky: same base scenario id (strip #vN and repeat) with mixed outcomes.
  const groups = new Map<string, boolean[]>();
  for (const r of scored) {
    const base = r.scenarioId.replace(/#v\d+$/, '');
    (groups.get(base) ?? groups.set(base, []).get(base)!).push(r.passed);
  }
  const flaky = [...groups.entries()]
    .filter(([, v]) => v.some(Boolean) && v.some((x) => !x))
    .map(([k]) => k);
  const lat = scored.map((r) => r.timings.wallMs).sort((a, b) => a - b);
  return {
    total: scored.length,
    passed: scored.filter((r) => r.passed).length,
    failed: scored.filter((r) => !r.passed).length,
    skipped: results.length - scored.length,
    passRate: scored.length ? scored.filter((r) => r.passed).length / scored.length : 0,
    hardGateFailures: scored.filter((r) => r.hardGateFailed).length,
    bySeverity,
    byCategory,
    byDifficulty,
    byLayer,
    latency: {
      p50: percentile(lat, 50),
      p95: percentile(lat, 95),
      max: lat.length ? Math.round(lat[lat.length - 1]!) : 0,
    },
    tokens: { totalOutput: scored.reduce((a, r) => a + r.tokens.output, 0) },
    flaky,
  };
}

function sanitize<T>(obj: T): T {
  return JSON.parse(redactSecrets(JSON.stringify(obj))) as T;
}

function reproCommand(r: ScenarioResult): string {
  const base = r.scenarioId.replace(/#v\d+$/, '');
  return `npm run eval:scenario -- --id ${base} --seed ${r.seed}`;
}

function suspectedComponent(r: ScenarioResult): string {
  const t = r.taxonomy[0];
  return (t && REMEDIATION_AREA[t]) || 'unknown';
}

/** Write the full run directory. Returns the run dir path. */
export function writeRun(
  reportsRoot: string,
  meta: RunMeta,
  env: EnvironmentInfo,
  results: ScenarioResult[],
): string {
  const runDir = join(reportsRoot, meta.runId);
  const failuresDir = join(runDir, 'failures');
  const transcriptsDir = join(runDir, 'transcripts');
  mkdirSync(failuresDir, { recursive: true });
  mkdirSync(transcriptsDir, { recursive: true });

  const agg = aggregate(results);
  const clean = results.map(sanitize);

  writeFileSync(join(runDir, 'config.json'), JSON.stringify(sanitize(meta), null, 2));
  writeFileSync(join(runDir, 'environment.json'), JSON.stringify(env, null, 2));
  writeFileSync(
    join(runDir, 'summary.json'),
    JSON.stringify({ meta: sanitize(meta), aggregate: agg }, null, 2),
  );
  writeFileSync(
    join(runDir, 'results.jsonl'),
    clean.map((r) => JSON.stringify(r)).join('\n') + '\n',
  );

  // CSV
  const csvHead =
    'id,version,seed,layer,category,difficulty,passed,skipped,severity,hardGate,wallMs,ttftMs,taxonomy,fingerprint';
  const csvRows = clean.map((r) =>
    [
      r.scenarioId,
      r.scenarioVersion,
      r.seed,
      r.layer,
      r.category,
      r.difficulty,
      r.passed,
      r.skipped,
      r.severity ?? '',
      r.hardGateFailed,
      Math.round(r.timings.wallMs),
      r.timings.timeToFirstTokenMs == null ? '' : Math.round(r.timings.timeToFirstTokenMs),
      r.taxonomy.join('|'),
      r.fingerprint ?? '',
    ].join(','),
  );
  writeFileSync(join(runDir, 'results.csv'), [csvHead, ...csvRows].join('\n') + '\n');

  // JUnit
  writeFileSync(join(runDir, 'junit.xml'), junit(meta, clean));

  // Transcripts (sanitized)
  for (const r of clean) {
    writeFileSync(
      join(transcriptsDir, `${r.scenarioId.replace(/[^A-Za-z0-9]/g, '_')}.json`),
      JSON.stringify({ transcript: r.transcript, toolTrace: r.toolTrace }, null, 2),
    );
  }

  // Failure reports (one per fingerprint) + backlog
  writeFailures(failuresDir, meta, clean);
  writeFileSync(join(runDir, 'FAILURE_BACKLOG.md'), backlog(meta, clean));

  // Markdown + HTML summaries
  writeFileSync(join(runDir, 'summary.md'), summaryMd(meta, env, agg, clean));
  writeFileSync(join(runDir, 'index.html'), summaryHtml(meta, agg, clean));

  return runDir;
}

function junit(meta: RunMeta, results: ScenarioResult[]): string {
  const cases = results
    .map((r) => {
      const name = `${r.scenarioId}`;
      const time = (r.timings.wallMs / 1000).toFixed(3);
      if (r.skipped)
        return `    <testcase name="${name}" time="${time}"><skipped message="${esc(r.skipReason ?? '')}"/></testcase>`;
      if (r.passed) return `    <testcase name="${name}" time="${time}"/>`;
      const failed = r.assertions
        .filter((a) => !a.passed)
        .map((a) => `${a.type}: ${a.detail}`)
        .join('; ');
      return `    <testcase name="${name}" time="${time}"><failure message="${esc(failed)}" type="${esc(r.severity ?? 'fail')}"/></testcase>`;
    })
    .join('\n');
  const failures = results.filter((r) => !r.passed && !r.skipped).length;
  const skipped = results.filter((r) => r.skipped).length;
  return `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="handoff-evals:${meta.suite}" tests="${results.length}" failures="${failures}" skipped="${skipped}">
${cases}
</testsuite>
`;
}

function writeFailures(dir: string, meta: RunMeta, results: ScenarioResult[]): void {
  const byFp = new Map<string, ScenarioResult[]>();
  for (const r of results) {
    if (r.passed || r.skipped || !r.fingerprint) continue;
    (byFp.get(r.fingerprint) ?? byFp.set(r.fingerprint, []).get(r.fingerprint)!).push(r);
  }
  for (const [fp, rs] of byFp) {
    const r = rs[0]!;
    const failed = r.assertions.filter((a) => !a.passed);
    const md = `# Failure ${fp}

## Classification
- Severity: ${r.severity}
- Category: ${r.category}
- Layer: ${r.layer}
- Taxonomy: ${r.taxonomy.join(', ')}
- Suspected component: ${suspectedComponent(r)}
- Reproduced: ${rs.length}/${rs.length} instance(s) this run
- Hard gate: ${r.hardGateFailed}

## Reproduce
\`\`\`
${reproCommand(r)}
\`\`\`
(commit ${meta.commit}, model ${meta.model}, system-prompt v${meta.systemPromptVersion}, runner v${meta.runnerVersion})

## Failed assertions
${failed.map((a) => `- \`${a.type}\` — ${a.detail}`).join('\n')}

## Actual final answer (sanitized)
\`\`\`
${(r.finalAnswer || '(empty)').slice(0, 1200)}
\`\`\`

## Tool trace
${r.toolTrace.length ? r.toolTrace.map((t) => `- ${t.name}(${t.args.slice(0, 80)}) → ${t.ok ? 'ok' : 'error'}${t.network ? ' [network]' : ''}`).join('\n') : '(none)'}

## Recommended next investigation
Likely area: **${suspectedComponent(r)}**. Confirm whether the failure is a model
limitation or a ${r.layer}-layer/product issue by replaying with \`--verbose\`.

## Regression test
Keep \`${r.scenarioId.replace(/#v\d+$/, '')}\` as a ${r.category} regression scenario.
`;
    writeFileSync(join(dir, `${fp}.md`), md);
  }
}

function backlog(meta: RunMeta, results: ScenarioResult[]): string {
  const fails = results.filter((r) => !r.passed && !r.skipped);
  const byArea = new Map<string, ScenarioResult[]>();
  for (const r of fails) {
    const area = suspectedComponent(r);
    (byArea.get(area) ?? byArea.set(area, []).get(area)!).push(r);
  }
  const areas = [...byArea.entries()].sort((a, b) => b[1].length - a[1].length);
  let md = `# Failure Backlog — run ${meta.runId}

Commit ${meta.commit} · model ${meta.model} · ${fails.length} failing instance(s) across ${areas.length} area(s).
Grouped by likely remediation area, highest-volume first. Each cluster is ready to become an engineering issue.

`;
  for (const [area, rs] of areas) {
    const sevs = new Set(rs.map((r) => r.severity));
    const worst = [...sevs].sort((a, b) => SEV_RANK[b as Severity] - SEV_RANK[a as Severity])[0];
    const ids = [...new Set(rs.map((r) => r.scenarioId.replace(/#v\d+$/, '')))];
    md += `## ${area}  (${rs.length} instance(s), worst severity: ${worst})

- Affected scenarios: ${ids.slice(0, 8).join(', ')}${ids.length > 8 ? ` … (+${ids.length - 8})` : ''}
- Taxonomy: ${[...new Set(rs.flatMap((r) => r.taxonomy))].join(', ')}
- Representative fingerprint: ${rs[0]!.fingerprint}
- Proposed fix scope: ${rs.length > 8 ? 'large' : rs.length > 3 ? 'medium' : 'small'}
- Overfitting risk: keep the whole cluster as regression scenarios; do not tune the prompt to a single instance.

`;
  }
  if (!fails.length) md += '_No failures this run._\n';
  return md;
}

// ── Issue-ready blocks for high/critical failures ────────────────────────────
export function issueBlocks(results: ScenarioResult[]): string {
  const hi = results.filter(
    (r) => !r.passed && !r.skipped && (r.severity === 'critical' || r.severity === 'high'),
  );
  if (!hi.length) return '';
  return hi
    .map(
      (r) => `### [${r.severity?.toUpperCase()}] ${r.scenarioId} — ${r.taxonomy.join('/')}
- Repro: \`${reproCommand(r)}\`
- Failed: ${r.assertions
        .filter((a) => !a.passed)
        .map((a) => a.type)
        .join(', ')}
- Suspected: ${suspectedComponent(r)}`,
    )
    .join('\n\n');
}

function summaryMd(
  meta: RunMeta,
  env: EnvironmentInfo,
  agg: Aggregate,
  results: ScenarioResult[],
): string {
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const catRows = Object.entries(agg.byCategory)
    .map(([k, v]) => `| ${k} | ${v.passed}/${v.total} | ${pct(v.passed / v.total)} |`)
    .join('\n');
  const layerRows = Object.entries(agg.byLayer)
    .map(([k, v]) => `| ${k} | ${v.passed}/${v.total} | ${pct(v.passed / v.total)} |`)
    .join('\n');
  const crit = results.filter(
    (r) => !r.passed && !r.skipped && (r.severity === 'critical' || r.severity === 'high'),
  );
  return `# Eval run ${meta.runId}

- Suite: **${meta.suite}** · Model: **${meta.model}** · Commit: ${meta.commit}
- System prompt v${meta.systemPromptVersion} · Runner v${meta.runnerVersion}
- Env: node ${env.node}, ${env.platform}/${env.arch}, ${env.cpus} cpu, ${env.memGb}GB

## Headline
- Pass rate: **${pct(agg.passRate)}** (${agg.passed}/${agg.total})
- Hard-gate failures: **${agg.hardGateFailures}**
- Skipped: ${agg.skipped}
- Severity of failures: ${JSON.stringify(agg.bySeverity)}
- Latency ms — p50 ${agg.latency.p50}, p95 ${agg.latency.p95}, max ${agg.latency.max}
- Flaky base scenarios: ${agg.flaky.length ? agg.flaky.join(', ') : 'none'}

## By category
| category | pass | rate |
|---|---|---|
${catRows}

## By layer
| layer | pass | rate |
|---|---|---|
${layerRows}

## Critical & high-severity failures
${crit.length ? crit.map((r) => `- **${r.severity}** ${r.scenarioId} (${r.taxonomy.join('/')}) — \`${reproCommand(r)}\``).join('\n') : '_none_'}

See \`FAILURE_BACKLOG.md\` and \`failures/\` for details, \`index.html\` for the interactive view.
`;
}

function summaryHtml(meta: RunMeta, agg: Aggregate, results: ScenarioResult[]): string {
  const data = JSON.stringify(
    results.map((r) => ({
      id: r.scenarioId,
      cat: r.category,
      layer: r.layer,
      diff: r.difficulty,
      passed: r.passed,
      skipped: r.skipped,
      sev: r.severity,
      wall: Math.round(r.timings.wallMs),
      fails: r.assertions.filter((a) => !a.passed).map((a) => `${a.type}: ${a.detail}`),
      answer: (r.finalAnswer || '').slice(0, 600),
      tools: r.toolTrace.map((t) => t.name),
    })),
  );
  return `<!doctype html><html><head><meta charset="utf-8"><title>eval ${meta.runId}</title>
<style>
body{font:14px system-ui,sans-serif;margin:2rem;color:#111}
h1{font-size:1.2rem} table{border-collapse:collapse;width:100%;margin:1rem 0}
td,th{border:1px solid #ddd;padding:4px 8px;text-align:left} tr.fail{background:#fee}
tr.skip{background:#eee} .sev-critical{color:#b00;font-weight:bold} .sev-high{color:#c50;font-weight:bold}
details{margin:2px 0} code{background:#f4f4f4;padding:1px 4px}
</style></head><body>
<h1>Handoff eval — ${meta.suite} — ${meta.runId}</h1>
<p>Model ${meta.model} · commit ${meta.commit} · pass ${Math.round(agg.passRate * 100)}% (${agg.passed}/${agg.total}) · hard-gate failures ${agg.hardGateFailures} · skipped ${agg.skipped}</p>
<table id="t"><thead><tr><th>scenario</th><th>cat</th><th>layer</th><th>diff</th><th>result</th><th>sev</th><th>ms</th><th>detail</th></tr></thead><tbody></tbody></table>
<script>
const R=${data};
const tb=document.querySelector('#t tbody');
for(const r of R){const tr=document.createElement('tr');
 tr.className=r.skipped?'skip':(r.passed?'':'fail');
 const res=r.skipped?'skip':(r.passed?'pass':'FAIL');
 const det=r.skipped?'':(r.passed?('tools: '+r.tools.join(', ')):('<details><summary>'+r.fails.length+' failed</summary><pre>'+r.fails.join('\\n').replace(/</g,'&lt;')+'</pre><pre>'+r.answer.replace(/</g,'&lt;')+'</pre></details>'));
 tr.innerHTML='<td>'+r.id+'</td><td>'+r.cat+'</td><td>'+r.layer+'</td><td>'+r.diff+'</td><td>'+res+'</td><td class="sev-'+(r.sev||'')+'">'+(r.sev||'')+'</td><td>'+r.wall+'</td><td>'+det+'</td>';
 tb.appendChild(tr);}
</script></body></html>`;
}

function esc(s: string): string {
  return s.replace(
    /[<>&"]/g,
    (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!,
  );
}

/** Concise terminal summary string. */
export function terminalSummary(meta: RunMeta, agg: Aggregate): string {
  const line = (s: string) => s;
  const crit = agg.bySeverity['critical'] ?? 0;
  const high = agg.bySeverity['high'] ?? 0;
  return [
    line(`Run ${meta.runId} · suite ${meta.suite} · model ${meta.model}`),
    line(
      `Pass ${agg.passed}/${agg.total} (${Math.round(agg.passRate * 100)}%) · hard-gate ${agg.hardGateFailures} · skipped ${agg.skipped}`,
    ),
    line(
      `Severity: critical ${crit}, high ${high}, medium ${agg.bySeverity['medium'] ?? 0}, low ${agg.bySeverity['low'] ?? 0}`,
    ),
    line(`Latency ms p50 ${agg.latency.p50} · p95 ${agg.latency.p95} · max ${agg.latency.max}`),
    agg.flaky.length ? line(`Flaky: ${agg.flaky.join(', ')}`) : '',
  ]
    .filter(Boolean)
    .join('\n');
}
