import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeTyped, classifyEnter, isCompleteEscapeSeq, caretRowCol } from '../ui/input.js';

const ESC = String.fromCharCode(27);

test('passes ordinary text through untouched', () => {
  assert.equal(sanitizeTyped('hello world'), 'hello world');
});

test('keeps bracket characters in normal text', () => {
  // Anchored to ESC, so "[a]" must survive — the original over-stripping bug.
  assert.equal(sanitizeTyped('arr[a] = b[0]'), 'arr[a] = b[0]');
});

test('strips bracketed-paste markers around a pasted token', () => {
  const pasted = `${ESC}[200~ghp_abc123${ESC}[201~`;
  assert.equal(sanitizeTyped(pasted), 'ghp_abc123');
});

test('strips arbitrary CSI escape sequences', () => {
  assert.equal(sanitizeTyped(`a${ESC}[31mred${ESC}[0mb`), 'aredb');
});

test('flattens pasted newlines and tabs into single spaces', () => {
  assert.equal(sanitizeTyped('line1\n\tline2'), 'line1 line2');
});

test('drops control bytes and DEL', () => {
  assert.equal(sanitizeTyped(`a\x01b\x7fc`), 'abc');
});

test('preserves a pasted Overleaf URL', () => {
  const url = 'https://www.overleaf.com/project/64a1f2c9';
  assert.equal(sanitizeTyped(url), url);
});

test('classifyEnter: Shift+Enter (modifyOtherKeys) → newline, with or without ESC', () => {
  assert.equal(classifyEnter(`${ESC}[27;2;13~`), 'newline');
  assert.equal(classifyEnter('[27;2;13~'), 'newline'); // Ink often strips the ESC
});

test('classifyEnter: kitty CSI-u Shift+Enter → newline; unmodified Enter → submit', () => {
  assert.equal(classifyEnter('[13;2u'), 'newline');
  assert.equal(classifyEnter('[27;1;13~'), 'submit');
  assert.equal(classifyEnter('[13u'), 'submit');
});

test('classifyEnter: ordinary input is not an Enter sequence', () => {
  assert.equal(classifyEnter('a'), null);
  assert.equal(classifyEnter('['), null);
  assert.equal(classifyEnter(''), null);
  assert.equal(classifyEnter('\r'), null);
});

test('isCompleteEscapeSeq: matches lone CSI sequences, not typed text', () => {
  assert.equal(isCompleteEscapeSeq('[1;2D'), true); // shift+left, ESC stripped
  assert.equal(isCompleteEscapeSeq(`${ESC}[3~`), true); // delete
  assert.equal(isCompleteEscapeSeq('[27;2;13~'), true); // shift+enter (handled earlier as newline)
  assert.equal(isCompleteEscapeSeq('['), false);
  assert.equal(isCompleteEscapeSeq('[a]'), false);
  assert.equal(isCompleteEscapeSeq('hello'), false);
});

test('caretRowCol locates the caret across lines and clamps overflow', () => {
  assert.deepEqual(caretRowCol('hello', 0), { row: 0, col: 0 });
  assert.deepEqual(caretRowCol('hello', 5), { row: 0, col: 5 }); // end of single line
  assert.deepEqual(caretRowCol('ab\ncd', 2), { row: 0, col: 2 }); // end of first line
  assert.deepEqual(caretRowCol('ab\ncd', 3), { row: 1, col: 0 }); // start of second line
  assert.deepEqual(caretRowCol('ab\ncd', 5), { row: 1, col: 2 }); // end of buffer
  assert.deepEqual(caretRowCol('ab\ncd', 99), { row: 1, col: 2 }); // clamps past end
});
