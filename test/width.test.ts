import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cellWidth, charWidth, sliceToWidth, stripAnsi } from '../ui/width.js';
import { wrap } from '../ui/lines.js';

test('ASCII width equals length', () => {
  assert.equal(cellWidth('hello'), 5);
  assert.equal(cellWidth(''), 0);
});

test('CJK characters are two cells each', () => {
  assert.equal(cellWidth('你好'), 4); // two wide chars
  assert.equal(cellWidth('a你b'), 4); // 1 + 2 + 1
  assert.equal(charWidth('好'.codePointAt(0)!), 2);
});

test('emoji are two cells (astral plane)', () => {
  assert.equal(cellWidth('😀'), 2);
  assert.equal(cellWidth('ab😀'), 4);
});

test('combining marks are zero width', () => {
  // "e" + combining acute accent renders as one cell.
  assert.equal(cellWidth('é'), 1);
  // zero-width joiner and variation selector count as zero.
  assert.equal(cellWidth('a‍b'), 2);
});

test('ANSI SGR sequences do not count toward width', () => {
  assert.equal(stripAnsi('\x1b[31mred\x1b[0m'), 'red');
  assert.equal(cellWidth('\x1b[31mred\x1b[0m'), 3);
});

test('sliceToWidth respects cell boundaries and never splits a wide char', () => {
  assert.deepEqual(sliceToWidth('hello', 3), { head: 'hel', rest: 'lo' });
  // "你好" is 4 cells; asking for 3 must take only the first (2 cells), not half of the second.
  assert.deepEqual(sliceToWidth('你好', 3), { head: '你', rest: '好' });
  assert.deepEqual(sliceToWidth('你好', 4), { head: '你好', rest: '' });
  // max 0 → nothing fits.
  assert.deepEqual(sliceToWidth('abc', 0), { head: '', rest: 'abc' });
});

test('wrap uses cell width: CJK line does not overflow', () => {
  // 5 CJK chars = 10 cells; at width 6 that is at most 3 chars per line.
  const lines = wrap('一二三四五', 6);
  for (const ln of lines) {
    assert.ok(cellWidth(ln) <= 6, `line "${ln}" width ${cellWidth(ln)} > 6`);
  }
  assert.equal(lines.join(''), '一二三四五');
});

test('wrap hard-splits a long unbroken word without dropping characters', () => {
  const word = 'x'.repeat(30);
  const lines = wrap(word, 8);
  for (const ln of lines) assert.ok(cellWidth(ln) <= 8);
  assert.equal(lines.join(''), word);
});

test('wrap makes progress even when a wide char exceeds a narrow width', () => {
  // width clamps to a 4-col minimum, but a 2-wide char must still emit.
  const lines = wrap('你好世界', 4);
  assert.ok(lines.length >= 1);
  assert.equal(lines.join(''), '你好世界');
});

test('wrap preserves ANSI-styled segments while measuring visible width', () => {
  const styled = '\x1b[31mhello world\x1b[0m';
  const lines = wrap(styled, 8);
  // Visible width honored; the join reconstructs the original words.
  assert.equal(lines.join(' ').replace(/\x1b\[[0-9;]*m/g, ''), 'hello world');
});
