import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseJsonl } from '../src/util/jsonl.js';

test('parses well-formed JSONL', () => {
  const rows = parseJsonl<{ a: number }>('{"a":1}\n{"a":2}\n{"a":3}');
  assert.deepEqual(rows, [{ a: 1 }, { a: 2 }, { a: 3 }]);
});

test('skips only the corrupt line, keeping every valid record', () => {
  // A half-written middle line must not discard the surrounding good records.
  const rows = parseJsonl<{ a: number }>('{"a":1}\n{"a":2\n{"a":3}');
  assert.deepEqual(rows, [{ a: 1 }, { a: 3 }]);
});

test('ignores blank and whitespace-only lines', () => {
  const rows = parseJsonl<{ a: number }>('\n{"a":1}\n   \n{"a":2}\n');
  assert.deepEqual(rows, [{ a: 1 }, { a: 2 }]);
});

test('returns empty for empty input', () => {
  assert.deepEqual(parseJsonl(''), []);
});
