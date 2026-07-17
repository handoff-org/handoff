/**
 * Clean a raw keypress / paste chunk for a single-line text field.
 *
 * Terminals wrap pasted text in "bracketed paste" markers (ESC[200~ … ESC[201~)
 * and may deliver stray escape sequences; left in place these corrupt a pasted
 * URL or token (or get misread as an Escape keypress). We strip those, drop
 * other control bytes, and flatten newlines/tabs to spaces so a multi-line paste
 * can't break the field. Every pattern is anchored to the ESC byte so ordinary
 * text — including brackets like "[a]" — is never touched.
 */
const ESC = String.fromCharCode(27);

export function sanitizeTyped(raw: string): string {
  const stripped = raw
    .replace(new RegExp(`${ESC}\\[20[01]~`, 'g'), '') // bracketed-paste markers
    .replace(new RegExp(`${ESC}\\[[0-9;?]*[ -/]*[@-~]`, 'g'), '') // other CSI sequences
    .replace(new RegExp(`${ESC}.?`, 'g'), '') // any remaining ESC (+ following byte)
    .replace(/[\r\n\t]+/g, ' '); // pasted newlines/tabs → single spaces

  return Array.from(stripped)
    .filter((c) => {
      const cp = c.codePointAt(0)!;
      return cp >= 32 && cp !== 127; // printable, not DEL
    })
    .join('');
}

/**
 * Classify an Enter keypress that arrives as an enhanced-keyboard escape sequence
 * Ink's key parser doesn't recognize. Terminals with xterm's modifyOtherKeys or
 * the kitty keyboard protocol encode Enter as `CSI 27;<mods>;13~` or `CSI 13;<mods>u`
 * — and Ink can hand us the sequence with the leading ESC already stripped, so we
 * match with or without it. Returns:
 *   'newline' — a modified Enter (e.g. Shift+Enter, mods > 1) → insert a line break
 *   'submit'  — an unmodified enhanced Enter → behave like a normal Return
 *   null      — not an Enter sequence
 */
export function classifyEnter(seq: string): 'newline' | 'submit' | null {
  const m = /^\x1b?\[(?:27;(\d+);13~|13(?:;(\d+))?u)$/.exec(seq);
  if (!m) return null;
  const mods = Number(m[1] ?? m[2] ?? '1'); // 1 = no modifiers in these encodings
  return mods > 1 ? 'newline' : 'submit';
}

/**
 * True if `seq` is exactly one complete CSI escape sequence (optionally with the
 * ESC byte already stripped by Ink). Used to swallow stray enhanced-keyboard
 * sequences — modified arrows, function keys — so they can't leak into the input
 * box as literal text. A single typed character (including a lone "[") is never a
 * complete sequence, so ordinary typing is unaffected.
 */
export function isCompleteEscapeSeq(seq: string): boolean {
  return /^\x1b?\[[0-9;?]*[ -/]*[@-~]$/.test(seq);
}

/**
 * Map a caret index into `value` (0..value.length) to its row/column when the
 * text is split on newlines. Used to draw the block caret on the right line of a
 * multi-line prompt. Out-of-range indices clamp to the end of the buffer.
 */
export function caretRowCol(value: string, cursor: number): { row: number; col: number } {
  const lines = value.split('\n');
  let rem = Math.max(0, Math.min(cursor, value.length));
  let row = 0;
  for (; row < lines.length; row++) {
    if (rem <= lines[row]!.length) break;
    rem -= lines[row]!.length + 1; // +1 for the '\n'
  }
  if (row >= lines.length) {
    row = lines.length - 1;
    rem = lines[row]!.length;
  }
  return { row, col: rem };
}

// ── Readline-style line editing (pure; wired into the key handler in app.tsx) ──
//
// Each returns the next {text, cursor}. Cursor is a code-unit index (matching
// the rest of the input handling), clamped into range. These operate on the
// whole buffer (single logical line for the common case); multi-line buffers are
// handled the same way since the field flattens on submit.

export interface EditState {
  text: string;
  cursor: number;
}

/** Ctrl-U: delete from the cursor back to the start of the buffer. */
export function killToStart(text: string, cursor: number): EditState {
  const c = clampCursor(text, cursor);
  return { text: text.slice(c), cursor: 0 };
}

/** Ctrl-K: delete from the cursor to the end of the buffer. */
export function killToEnd(text: string, cursor: number): EditState {
  const c = clampCursor(text, cursor);
  return { text: text.slice(0, c), cursor: c };
}

/**
 * Ctrl-W: delete the whitespace-delimited word before the cursor, including any
 * run of spaces immediately preceding it (so repeated presses chew back words).
 */
export function deleteWordBack(text: string, cursor: number): EditState {
  let c = clampCursor(text, cursor);
  const start = c;
  // Skip trailing spaces just before the cursor.
  while (c > 0 && text[c - 1] === ' ') c--;
  // Then skip the word characters.
  while (c > 0 && text[c - 1] !== ' ') c--;
  return { text: text.slice(0, c) + text.slice(start), cursor: c };
}

function clampCursor(text: string, cursor: number): number {
  return Math.max(0, Math.min(cursor, text.length));
}

/**
 * A bounded, immutable input-history cursor. `entries` is oldest→newest. The
 * cursor sits "below" the newest entry (index === entries.length) meaning "the
 * live draft"; `prev()` walks toward older entries, `next()` back toward the
 * draft. `draft` is the text the user had typed before starting to browse, so
 * returning past the newest entry restores it.
 */
export class HistoryCursor {
  private idx: number;
  constructor(
    private readonly entries: string[],
    private readonly draft: string,
  ) {
    this.idx = entries.length; // start at the live draft
  }

  /** Move to an older entry; returns its text, or null if already at the oldest. */
  prev(): string | null {
    if (this.entries.length === 0) return null;
    if (this.idx === 0) return this.entries[0] ?? null;
    this.idx -= 1;
    return this.entries[this.idx] ?? null;
  }

  /** Move to a newer entry; returns its text, or the draft when back at the bottom. */
  next(): string | null {
    if (this.idx >= this.entries.length) return null; // already at the draft
    this.idx += 1;
    if (this.idx >= this.entries.length) return this.draft;
    return this.entries[this.idx] ?? null;
  }

  /** True when the cursor is at the live draft (not browsing history). */
  atDraft(): boolean {
    return this.idx >= this.entries.length;
  }
}

/**
 * Append a submitted input to a bounded history ring (oldest→newest), skipping
 * empties and consecutive duplicates. Returns a new array (never mutates).
 */
export function pushHistory(history: string[], entry: string, max = 100): string[] {
  const e = entry.trim();
  if (!e) return history;
  if (history.length && history[history.length - 1] === e) return history;
  const next = [...history, e];
  return next.length > max ? next.slice(next.length - max) : next;
}
