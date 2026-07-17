import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dabstepScorer } from '../src/adapters/dabstep.js';

test('exact string match (case/space/quote-insensitive)', () => {
  assert.equal(dabstepScorer('NL', 'NL'), true);
  assert.equal(dabstepScorer(' nl ', 'NL'), true);
  assert.equal(dabstepScorer('"NL"', 'NL'), true);
  assert.equal(dabstepScorer('DE', 'NL'), false);
});

test('numeric answers use a tight tolerance', () => {
  assert.equal(dabstepScorer('123.45', '123.45'), true);
  assert.equal(dabstepScorer('123.454', '123.45'), true); // within 0.01
  assert.equal(dabstepScorer('123.99', '123.45'), false); // too far
  assert.equal(dabstepScorer('€1,234.50', '1234.50'), true); // currency/commas stripped
});

test('not-applicable family matches', () => {
  assert.equal(dabstepScorer('Not Applicable', 'Not Applicable'), true);
  assert.equal(dabstepScorer('N/A', 'not applicable'), true);
  assert.equal(dabstepScorer('42', 'Not Applicable'), false);
});

test('list answers compare as sets', () => {
  assert.equal(dabstepScorer('A, B, C', 'C, B, A'), true);
  assert.equal(dabstepScorer('A, B', 'A, B, C'), false);
});

test('null / empty-expected never pass', () => {
  assert.equal(dabstepScorer(null, 'NL'), false);
  assert.equal(dabstepScorer('NL', ''), false); // held-out test answer
});
