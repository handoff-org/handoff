import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeTyped,
  classifyEnter,
  isCompleteEscapeSeq,
  caretRowCol,
  killToStart,
  killToEnd,
  deleteWordBack,
  HistoryCursor,
  pushHistory,
} from '../ui/input.js';
import { redactSecrets } from '../src/util/redact.js';

const ESC = String.fromCharCode(27);

// ── sanitizeTyped ─────────────────────────────────────────────────────────────

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

test('sanitizeTyped: handles CRLF line endings', () => {
  assert.equal(sanitizeTyped('line1\r\nline2'), 'line1 line2');
});

test('sanitizeTyped: handles empty string', () => {
  assert.equal(sanitizeTyped(''), '');
});

test('sanitizeTyped: pasted multiline URL — content survives, newlines become spaces', () => {
  const url = 'https://arxiv.org/abs/2501.12345';
  const result = sanitizeTyped(`${ESC}[200~${url}${ESC}[201~`);
  assert.equal(result, url);
});

// ── classifyEnter ─────────────────────────────────────────────────────────────

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

test('classifyEnter: higher modifier values are newline', () => {
  // mods=4 = Shift+Ctrl, mods=8 = Shift+Alt — all > 1 are newline
  assert.equal(classifyEnter('[27;4;13~'), 'newline');
  assert.equal(classifyEnter('[13;4u'), 'newline');
});

// ── isCompleteEscapeSeq ───────────────────────────────────────────────────────

test('isCompleteEscapeSeq: matches lone CSI sequences, not typed text', () => {
  assert.equal(isCompleteEscapeSeq('[1;2D'), true); // shift+left, ESC stripped
  assert.equal(isCompleteEscapeSeq(`${ESC}[3~`), true); // delete
  assert.equal(isCompleteEscapeSeq('[27;2;13~'), true); // shift+enter (handled earlier as newline)
  assert.equal(isCompleteEscapeSeq('['), false);
  assert.equal(isCompleteEscapeSeq('[a]'), false);
  assert.equal(isCompleteEscapeSeq('hello'), false);
});

test('isCompleteEscapeSeq: Ctrl+Up/Down CSI sequences are complete sequences', () => {
  assert.equal(isCompleteEscapeSeq(`${ESC}[1;5A`), true); // Ctrl+Up
  assert.equal(isCompleteEscapeSeq(`${ESC}[1;5B`), true); // Ctrl+Down
  assert.equal(isCompleteEscapeSeq('[1;5A'), true); // ESC stripped
});

// ── caretRowCol ───────────────────────────────────────────────────────────────

test('caretRowCol locates the caret across lines and clamps overflow', () => {
  assert.deepEqual(caretRowCol('hello', 0), { row: 0, col: 0 });
  assert.deepEqual(caretRowCol('hello', 5), { row: 0, col: 5 }); // end of single line
  assert.deepEqual(caretRowCol('ab\ncd', 2), { row: 0, col: 2 }); // end of first line
  assert.deepEqual(caretRowCol('ab\ncd', 3), { row: 1, col: 0 }); // start of second line
  assert.deepEqual(caretRowCol('ab\ncd', 5), { row: 1, col: 2 }); // end of buffer
  assert.deepEqual(caretRowCol('ab\ncd', 99), { row: 1, col: 2 }); // clamps past end
});

test('caretRowCol: three-line text', () => {
  const text = 'a\nbb\nccc';
  assert.deepEqual(caretRowCol(text, 0), { row: 0, col: 0 });
  assert.deepEqual(caretRowCol(text, 1), { row: 0, col: 1 });
  assert.deepEqual(caretRowCol(text, 2), { row: 1, col: 0 });
  assert.deepEqual(caretRowCol(text, 4), { row: 1, col: 2 });
  assert.deepEqual(caretRowCol(text, 5), { row: 2, col: 0 });
  assert.deepEqual(caretRowCol(text, 8), { row: 2, col: 3 });
});

// ── readline kill helpers ─────────────────────────────────────────────────────

test('killToStart: deletes from cursor back to start', () => {
  assert.deepEqual(killToStart('hello', 3), { text: 'lo', cursor: 0 });
  assert.deepEqual(killToStart('hello', 0), { text: 'hello', cursor: 0 });
  assert.deepEqual(killToStart('hello', 5), { text: '', cursor: 0 });
});

test('killToEnd: deletes from cursor to end', () => {
  assert.deepEqual(killToEnd('hello', 3), { text: 'hel', cursor: 3 });
  assert.deepEqual(killToEnd('hello', 0), { text: '', cursor: 0 });
  assert.deepEqual(killToEnd('hello', 5), { text: 'hello', cursor: 5 });
});

test('deleteWordBack: deletes the word before the cursor', () => {
  // cursor at end of 'hello world' — deletes 'world'
  assert.deepEqual(deleteWordBack('hello world', 11), { text: 'hello ', cursor: 6 });
  // cursor at end of 'hello  world' (double space) — deletes 'world'
  assert.deepEqual(deleteWordBack('hello  world', 12), { text: 'hello  ', cursor: 7 });
  // cursor at end of 'hello ' (trailing space) — skips space then deletes 'hello'
  assert.deepEqual(deleteWordBack('hello ', 6), { text: '', cursor: 0 });
  // At the beginning — no change
  assert.deepEqual(deleteWordBack('hello', 0), { text: 'hello', cursor: 0 });
});

test('deleteWordBack: handles cursor in the middle of a word', () => {
  // "hel|lo" — deletes "hel", leaves "lo"
  assert.deepEqual(deleteWordBack('hello', 3), { text: 'lo', cursor: 0 });
});

// ── HistoryCursor ─────────────────────────────────────────────────────────────

test('HistoryCursor: empty history — prev returns null, next does nothing', () => {
  const c = new HistoryCursor([], '');
  assert.equal(c.prev(), null);
  assert.equal(c.next(), null);
  assert.equal(c.atDraft(), true);
});

test('HistoryCursor: single entry — prev returns it, next returns draft', () => {
  const c = new HistoryCursor(['hello'], 'current');
  assert.equal(c.prev(), 'hello');
  assert.equal(c.atDraft(), false);
  assert.equal(c.next(), 'current'); // draft restored
  assert.equal(c.atDraft(), true);
});

test('HistoryCursor: multiple entries — prev walks newest-first, next returns to draft', () => {
  // entries oldest→newest: ['a', 'b', 'c']
  const c = new HistoryCursor(['a', 'b', 'c'], 'draft');
  assert.equal(c.prev(), 'c'); // newest first
  assert.equal(c.prev(), 'b');
  assert.equal(c.prev(), 'a');
  // Clamped at oldest
  assert.equal(c.prev(), 'a');
  assert.equal(c.atDraft(), false);
  // Walk back toward draft
  assert.equal(c.next(), 'b');
  assert.equal(c.next(), 'c');
  assert.equal(c.next(), 'draft');
  assert.equal(c.atDraft(), true);
  assert.equal(c.next(), null); // already at draft
});

test('HistoryCursor: draft is preserved when navigating past newest', () => {
  const c = new HistoryCursor(['a', 'b'], 'in-progress text');
  c.prev(); // → 'b'
  c.prev(); // → 'a'
  c.next(); // → 'b'
  assert.equal(c.next(), 'in-progress text');
  assert.equal(c.atDraft(), true);
});

test('HistoryCursor: navigating past oldest clamps to oldest', () => {
  const c = new HistoryCursor(['only'], '');
  assert.equal(c.prev(), 'only');
  assert.equal(c.prev(), 'only'); // stays at oldest
  assert.equal(c.atDraft(), false);
});

test('HistoryCursor: atDraft true initially, false while browsing, true after returning', () => {
  const c = new HistoryCursor(['x'], 'draft');
  assert.equal(c.atDraft(), true);
  c.prev();
  assert.equal(c.atDraft(), false);
  c.next();
  assert.equal(c.atDraft(), true);
});

test('HistoryCursor: empty draft string is preserved correctly', () => {
  const c = new HistoryCursor(['a'], '');
  c.prev(); // → 'a'
  assert.equal(c.next(), ''); // empty draft restored
});

// ── pushHistory ───────────────────────────────────────────────────────────────

test('pushHistory: appends a new entry to empty history', () => {
  assert.deepEqual(pushHistory([], 'hello'), ['hello']);
});

test('pushHistory: does not add blank or whitespace-only entries', () => {
  assert.deepEqual(pushHistory(['a'], ''), ['a']);
  assert.deepEqual(pushHistory(['a'], '   '), ['a']);
  assert.deepEqual(pushHistory(['a'], '\t\n'), ['a']);
});

test('pushHistory: does not add consecutive duplicates', () => {
  assert.deepEqual(pushHistory(['a', 'b'], 'b'), ['a', 'b']);
});

test('pushHistory: allows non-consecutive duplicates', () => {
  assert.deepEqual(pushHistory(['a', 'b'], 'a'), ['a', 'b', 'a']);
});

test('pushHistory: trims whitespace before comparing and storing', () => {
  // Trimmed 'hello' equals last entry → not added
  assert.deepEqual(pushHistory(['hello'], '  hello  '), ['hello']);
  assert.deepEqual(pushHistory(['hello'], '  world  '), ['hello', 'world']);
});

test('pushHistory: caps at default max of 100 entries', () => {
  const full = Array.from({ length: 100 }, (_, i) => `entry${i}`);
  const next = pushHistory(full, 'entry100');
  assert.equal(next.length, 100);
  assert.equal(next[0], 'entry1');
  assert.equal(next[99], 'entry100');
});

test('pushHistory: caps at a custom max', () => {
  assert.deepEqual(pushHistory(['a', 'b', 'c'], 'd', 3), ['b', 'c', 'd']);
});

test('pushHistory: never mutates the original array', () => {
  const orig = ['a', 'b'];
  pushHistory(orig, 'c');
  assert.deepEqual(orig, ['a', 'b']);
});

test('pushHistory: empty history stays empty on blank input', () => {
  assert.deepEqual(pushHistory([], ''), []);
  assert.deepEqual(pushHistory([], '  '), []);
});

// ── redactSecrets: prompt history must not persist plaintext secrets ──────────

test('redactSecrets: strips HuggingFace hf_ tokens', () => {
  const out = redactSecrets('hf_abcdefghijk1234');
  assert.doesNotMatch(out, /hf_/);
  assert.match(out, /•••/);
});

test('redactSecrets: strips OpenAI sk- keys', () => {
  const out = redactSecrets('sk-abcdefghijklmnopqrst12345');
  assert.doesNotMatch(out, /sk-/);
  assert.match(out, /•••/);
});

test('redactSecrets: strips GitHub personal access tokens', () => {
  const out = redactSecrets('ghp_abcdefghijklmnopqrst12345678');
  assert.doesNotMatch(out, /ghp_/);
  assert.match(out, /•••/);
});

test('redactSecrets: strips AWS AKIA access key ids', () => {
  const out = redactSecrets('AKIAIOSFODNN7EXAMPLE');
  assert.doesNotMatch(out, /AKIA/);
  assert.match(out, /•••/);
});

test('redactSecrets: strips Bearer tokens in Authorization-like strings', () => {
  const out = redactSecrets('authorization: Bearer eyJhbGciOiJSUzI1NiJ9.payload.sig');
  assert.doesNotMatch(out, /eyJ/);
  assert.match(out, /•••/);
});

test('redactSecrets: leaves ordinary research prose unchanged', () => {
  const text = 'Find papers on attention mechanisms in transformer models';
  assert.equal(redactSecrets(text), text);
});

test('redactSecrets: is idempotent', () => {
  const once = redactSecrets('hf_abcdefghijk1234');
  assert.equal(redactSecrets(once), once);
});

test('secret-containing prompt is safe to store after redaction', () => {
  const raw = 'use token hf_abcdefghijk1234 for the HF backend';
  const safe = redactSecrets(raw.trim());
  const h = pushHistory([], safe);
  assert.doesNotMatch(h[0]!, /hf_/);
  assert.match(h[0]!, /•••/);
});
