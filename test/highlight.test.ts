import { test } from 'node:test';
import assert from 'node:assert/strict';
import { highlight, type Span } from '../ui/highlight.js';

const KEYWORD = '#c678dd';
const STRING = '#98c379';
const COMMENT = '#7f848e';
const NUMBER = '#d19a66';
const FUNC = '#61afef';

/** The full line, reassembled from its spans (highlighting must be lossless). */
function joined(spans: Span[]): string {
  return spans.map((s) => s.text).join('');
}

/** The color applied to the first span whose text contains `needle`. */
function colorOf(spans: Span[], needle: string): string | undefined {
  return spans.find((s) => s.text.includes(needle))?.color;
}

test('round-trips the original line exactly', () => {
  const line = 'def add(a, b):  # sum';
  assert.equal(joined(highlight(line, 'python')), line);
});

test('colors python keywords', () => {
  const spans = highlight('def add(a):', 'py');
  assert.equal(colorOf(spans, 'def'), KEYWORD);
});

test('colors a function call name', () => {
  const spans = highlight('print(x)', 'python');
  // `print` is a python keyword in our set, so check a non-keyword call.
  const spans2 = highlight('compute(x)', 'python');
  assert.equal(colorOf(spans2, 'compute'), FUNC);
  assert.ok(spans.length > 0);
});

test('colors strings', () => {
  const spans = highlight('x = "hello"', 'js');
  assert.equal(colorOf(spans, '"hello"'), STRING);
});

test('colors numbers', () => {
  const spans = highlight('x = 42', 'js');
  assert.equal(colorOf(spans, '42'), NUMBER);
});

test('colors hash comments outside js', () => {
  const spans = highlight('x = 1  # note', 'python');
  assert.equal(colorOf(spans, '# note'), COMMENT);
});

test('treats # as code in js (not a comment)', () => {
  const spans = highlight('a # b', 'js');
  assert.equal(colorOf(spans, '#'), undefined);
});

test('colors // comments in js', () => {
  const spans = highlight('let x = 1; // done', 'js');
  assert.equal(colorOf(spans, '// done'), COMMENT);
});

test('returns one plain span for an empty line', () => {
  const spans = highlight('', 'generic');
  assert.deepEqual(spans, [{ text: '' }]);
});
