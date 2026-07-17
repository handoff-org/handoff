// Pure math for statistical summaries — no external dependencies.
// Provides per-metric descriptive stats with 95% confidence intervals and
// pairwise comparison stats (Cohen's d, percent difference).

// Student's t critical values for 95% two-tailed CI (df = n-1, 1-indexed so
// T_TABLE[df] = t_{0.975,df}). Values for df 1–30; beyond that use 1.96.
const T_TABLE: Record<number, number> = {
  1: 12.706,
  2: 4.303,
  3: 3.182,
  4: 2.776,
  5: 2.571,
  6: 2.447,
  7: 2.365,
  8: 2.306,
  9: 2.262,
  10: 2.228,
  11: 2.201,
  12: 2.179,
  13: 2.16,
  14: 2.145,
  15: 2.131,
  16: 2.12,
  17: 2.11,
  18: 2.101,
  19: 2.093,
  20: 2.086,
  21: 2.08,
  22: 2.074,
  23: 2.069,
  24: 2.064,
  25: 2.06,
  26: 2.056,
  27: 2.052,
  28: 2.048,
  29: 2.045,
  30: 2.042,
};

function tCritical(df: number): number {
  if (df <= 0) return Infinity;
  if (df <= 30) return T_TABLE[df] ?? 2.042;
  return 1.96; // Gaussian approximation for large n
}

export interface StatsSummary {
  metricKey: string;
  n: number;
  mean: number;
  std: number;
  ci95Low: number;
  ci95High: number;
  min: number;
  max: number;
}

export function summarizeMetric(values: number[], metricKey = ''): StatsSummary {
  const n = values.length;
  if (n === 0) {
    return {
      metricKey,
      n: 0,
      mean: NaN,
      std: NaN,
      ci95Low: NaN,
      ci95High: NaN,
      min: NaN,
      max: NaN,
    };
  }
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = n > 1 ? values.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1) : 0;
  const std = Math.sqrt(variance);
  const se = n > 1 ? std / Math.sqrt(n) : 0;
  const t = tCritical(n - 1);
  const margin = t * se;
  const min = Math.min(...values);
  const max = Math.max(...values);
  return { metricKey, n, mean, std, ci95Low: mean - margin, ci95High: mean + margin, min, max };
}

export type EffectLabel = 'negligible' | 'small' | 'medium' | 'large';

export interface ComparisonStats {
  metricKey: string;
  treatmentN: number;
  baselineN: number;
  treatmentMean: number;
  baselineMean: number;
  cohensD: number;
  percentDiff: number;
  effectLabel: EffectLabel;
}

function pooledStd(t: number[], b: number[]): number {
  const nt = t.length,
    nb = b.length;
  if (nt + nb <= 2) return 1;
  const mt = t.reduce((a, x) => a + x, 0) / nt;
  const mb = b.reduce((a, x) => a + x, 0) / nb;
  const vt = t.reduce((a, x) => a + (x - mt) ** 2, 0);
  const vb = b.reduce((a, x) => a + (x - mb) ** 2, 0);
  return Math.sqrt((vt + vb) / (nt + nb - 2));
}

function effectLabel(d: number): EffectLabel {
  const abs = Math.abs(d);
  if (abs < 0.2) return 'negligible';
  if (abs < 0.5) return 'small';
  if (abs < 0.8) return 'medium';
  return 'large';
}

export function compareMetrics(
  treatment: number[],
  baseline: number[],
  metricKey = '',
): ComparisonStats {
  const treatmentMean = treatment.reduce((a, b) => a + b, 0) / (treatment.length || 1);
  const baselineMean = baseline.reduce((a, b) => a + b, 0) / (baseline.length || 1);
  const ps = pooledStd(treatment, baseline);
  const cohensD = ps > 0 ? (treatmentMean - baselineMean) / ps : 0;
  const percentDiff =
    baselineMean !== 0 ? ((treatmentMean - baselineMean) / Math.abs(baselineMean)) * 100 : 0;
  return {
    metricKey,
    treatmentN: treatment.length,
    baselineN: baseline.length,
    treatmentMean,
    baselineMean,
    cohensD,
    percentDiff,
    effectLabel: effectLabel(cohensD),
  };
}

function fmt(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return n.toPrecision(4).replace(/\.?0+$/, '');
}

/** Render a stats summary as a scannable text block. */
export function formatStatsSummary(s: StatsSummary): string {
  const lines: string[] = [
    `  Metric:  ${s.metricKey}`,
    `  n:       ${s.n}`,
    `  Mean:    ${fmt(s.mean)}`,
    `  Std:     ${fmt(s.std)}`,
    `  95% CI:  [${fmt(s.ci95Low)}, ${fmt(s.ci95High)}]`,
    `  Range:   ${fmt(s.min)} – ${fmt(s.max)}`,
  ];
  return lines.join('\n');
}

/** Render comparison stats as a scannable text block. */
export function formatComparisonStats(c: ComparisonStats): string {
  const sign = c.percentDiff >= 0 ? '+' : '';
  const lines: string[] = [
    `  Metric:       ${c.metricKey}`,
    `  Treatment:    ${fmt(c.treatmentMean)}  (n=${c.treatmentN})`,
    `  Baseline:     ${fmt(c.baselineMean)}  (n=${c.baselineN})`,
    `  Δ:            ${sign}${fmt(c.percentDiff)}%`,
    `  Cohen's d:    ${fmt(c.cohensD)}  (${c.effectLabel})`,
  ];
  return lines.join('\n');
}

/**
 * Build a ready-to-paste LaTeX snippet for the stats of one metric.
 * Example output: "achieves $92.1 \pm 1.4\%$ (95\% CI: $[89.8, 93.9]$)"
 */
export function statsLatexSnippet(s: StatsSummary, isPercent = false): string {
  const pct = isPercent ? '\\%' : '';
  const mean = fmt(s.mean);
  const std = fmt(s.std);
  const lo = fmt(s.ci95Low);
  const hi = fmt(s.ci95High);
  if (s.n < 2) return `$${mean}${pct}$`;
  return `$${mean}${pct} \\pm ${std}${pct}$ (95\\% CI: $[${lo}, ${hi}]$)`;
}
