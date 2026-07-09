import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  metricsTable,
  figureBlock,
  formatNumber,
  isFigureFile,
  sanitizeRef,
} from '../src/workspace/resultsTable.js';

test('formatNumber: integers verbatim, floats to 4 sig figs, noise trimmed', () => {
  assert.equal(formatNumber(1234), '1234');
  assert.equal(formatNumber(3), '3');
  assert.equal(formatNumber(0.94736), '0.9474');
  assert.equal(formatNumber(0.1 + 0.2), '0.3');
  assert.equal(formatNumber(NaN), 'NaN');
});

test('isFigureFile: recognizes image/PDF extensions, case-insensitively', () => {
  assert.equal(isFigureFile('figures/loss.png'), true);
  assert.equal(isFigureFile('a.PDF'), true);
  assert.equal(isFigureFile('plot.svg'), true);
  assert.equal(isFigureFile('metrics.json'), false);
  assert.equal(isFigureFile('notes'), false);
});

test('sanitizeRef: keeps [A-Za-z0-9_-], strips the rest, falls back to results', () => {
  assert.equal(sanitizeRef('Main Results!'), 'MainResults');
  assert.equal(sanitizeRef('--tab.1'), 'tab1');
  assert.equal(sanitizeRef('***'), 'results');
});

test('metricsTable: single run renders a Metric | Value table', () => {
  const { latex, markdown } = metricsTable([
    { label: 'run1', metrics: { acc: 0.947, loss: 0.21 } },
  ]);
  assert.match(latex, /\\begin\{table\}/);
  assert.match(latex, /\\toprule/);
  assert.match(latex, /Metric & Value/);
  assert.match(latex, /acc & 0\.947/);
  assert.match(markdown, /\| Metric \| Value \|/);
  assert.match(markdown, /\| acc \| 0\.947 \|/);
});

test('metricsTable: multiple runs render a Run × metrics matrix with union columns', () => {
  const { latex, markdown } = metricsTable([
    { label: 'baseline', metrics: { acc: 0.9 } },
    { label: 'tuned', metrics: { acc: 0.8, f1: 0.7 } },
  ]);
  // Union of keys, sorted: acc, f1
  assert.match(latex, /Run & acc & f1/);
  assert.match(markdown, /\| Run \| acc \| f1 \|/);
  // baseline has no f1 → placeholder
  assert.match(markdown, /\| baseline \| 0\.9 \| -- \|/);
});

test('metricsTable: keys option restricts and orders the columns', () => {
  const { markdown } = metricsTable(
    [
      { label: 'a', metrics: { acc: 0.9, loss: 0.3, f1: 0.5 } },
      { label: 'b', metrics: { acc: 0.8, loss: 0.2, f1: 0.6 } },
    ],
    { keys: ['loss', 'acc'] },
  );
  assert.match(markdown, /\| Run \| loss \| acc \|/);
  assert.doesNotMatch(markdown, /f1/);
});

test('metricsTable: caption is LaTeX-escaped and label sanitized', () => {
  const { latex } = metricsTable([{ label: 'r', metrics: { x: 1 } }], {
    caption: 'A & B results',
    label: 'main results',
  });
  assert.match(latex, /\\caption\{A \\& B results\}/);
  assert.match(latex, /\\label\{tab:mainresults\}/);
});

test('figureBlock: emits a figure environment + markdown image, label defaults to stem', () => {
  const { latex, markdown } = figureBlock({ path: 'figures/loss.png', caption: 'Training loss' });
  assert.match(latex, /\\begin\{figure\}/);
  assert.match(latex, /\\includegraphics\[width=0\.8\\linewidth\]\{figures\/loss\.png\}/);
  assert.match(latex, /\\caption\{Training loss\}/);
  assert.match(latex, /\\label\{fig:loss\}/);
  assert.equal(markdown, '![Training loss](figures/loss.png)');
});
