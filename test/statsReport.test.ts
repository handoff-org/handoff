import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeMetric, compareMetrics } from '../src/workspace/statsReport.js';

function approx(a: number, b: number, tol = 0.001): boolean {
  return Math.abs(a - b) < tol;
}

test('summarizeMetric returns NaN fields for empty array', () => {
  const s = summarizeMetric([]);
  assert.equal(s.n, 0);
  assert.ok(Number.isNaN(s.mean));
  assert.ok(Number.isNaN(s.std));
});

test('summarizeMetric single value has zero std and wide CI', () => {
  const s = summarizeMetric([0.9], 'acc');
  assert.equal(s.n, 1);
  assert.equal(s.mean, 0.9);
  assert.equal(s.std, 0);
  assert.equal(s.metricKey, 'acc');
});

test('summarizeMetric five values — known mean and CI', () => {
  // mean=0.9, values=[0.85,0.88,0.90,0.92,0.95]
  // std=sqrt(0.00145)≈0.03808, se≈0.01703, df=4, t=2.776 → margin≈0.0473
  // CI ≈ [0.852, 0.948]
  const values = [0.85, 0.88, 0.90, 0.92, 0.95];
  const s = summarizeMetric(values, 'f1');
  assert.equal(s.n, 5);
  assert.ok(approx(s.mean, 0.9, 0.001));
  assert.ok(s.ci95Low < s.mean);
  assert.ok(s.ci95High > s.mean);
  assert.ok(approx(s.ci95Low, 0.852, 0.01), `ci95Low=${s.ci95Low}`);
  assert.ok(approx(s.ci95High, 0.948, 0.01), `ci95High=${s.ci95High}`);
  assert.equal(s.min, 0.85);
  assert.equal(s.max, 0.95);
});

test('summarizeMetric large n uses Gaussian approximation (t≈1.96)', () => {
  // 31 identical values → std=0, CI collapses to the mean
  const values = Array.from({ length: 31 }, () => 1.0);
  const s = summarizeMetric(values);
  assert.ok(approx(s.mean, 1.0));
  assert.ok(approx(s.ci95Low, 1.0));
  assert.ok(approx(s.ci95High, 1.0));
});

test('compareMetrics returns Cohen\'s d and effect label', () => {
  const treatment = [0.90, 0.92, 0.91, 0.93, 0.90];
  const baseline  = [0.80, 0.82, 0.81, 0.83, 0.80];
  const c = compareMetrics(treatment, baseline, 'acc');
  assert.ok(c.cohensD > 0, 'treatment > baseline → positive d');
  assert.ok(c.percentDiff > 0);
  assert.ok(['small', 'medium', 'large'].includes(c.effectLabel));
  assert.equal(c.metricKey, 'acc');
});

test('compareMetrics negligible effect when means are equal', () => {
  const a = [0.85, 0.86, 0.84];
  const b = [0.85, 0.86, 0.84];
  const c = compareMetrics(a, b);
  assert.ok(approx(c.cohensD, 0));
  assert.equal(c.effectLabel, 'negligible');
});

test('summarizeMetric symmetric values have symmetric CI', () => {
  const values = [0.8, 0.9, 1.0];
  const s = summarizeMetric(values);
  assert.ok(approx(s.mean - s.ci95Low, s.ci95High - s.mean, 0.0001), 'CI should be symmetric');
});
