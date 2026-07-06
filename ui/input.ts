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
