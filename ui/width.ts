/**
 * Terminal cell-width measurement. A terminal lays text out in fixed cells, and
 * not every code point occupies one cell: East-Asian wide chars and most emoji
 * take two, combining marks and zero-width chars take zero, and ANSI escape
 * sequences take none. Wrapping/truncation by JavaScript string `.length`
 * (UTF-16 code units) therefore mis-measures CJK/emoji/accented text and can
 * overflow the terminal or wrap far too early.
 *
 * This is a small, dependency-free approximation good enough for a TUI: it
 * covers the common wide ranges and zero-width categories. It is NOT a full
 * Unicode width table (no grapheme clustering of ZWJ emoji sequences), which is
 * a deliberate size/complexity trade-off documented here.
 */

const ANSI_RE = /\x1b\[[0-9;]*m/g;

/** Strip ANSI SGR color/style sequences so they don't count toward width. */
export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '');
}

/** True for zero-width code points: combining marks, ZWJ, variation selectors, BOM. */
function isZeroWidth(cp: number): boolean {
  return (
    cp === 0x200b || // zero-width space
    cp === 0x200d || // zero-width joiner
    cp === 0xfeff || // BOM / zero-width no-break space
    (cp >= 0x0300 && cp <= 0x036f) || // combining diacritical marks
    (cp >= 0x1ab0 && cp <= 0x1aff) || // combining diacritical marks extended
    (cp >= 0x1dc0 && cp <= 0x1dff) || // combining diacritical marks supplement
    (cp >= 0x20d0 && cp <= 0x20ff) || // combining marks for symbols
    (cp >= 0xfe00 && cp <= 0xfe0f) || // variation selectors
    (cp >= 0xfe20 && cp <= 0xfe2f) // combining half marks
  );
}

/** True for code points that occupy two terminal cells (wide / fullwidth). */
function isWide(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115f) || // Hangul Jamo
    (cp >= 0x2e80 && cp <= 0x303e) || // CJK radicals, Kangxi
    (cp >= 0x3041 && cp <= 0x33ff) || // Hiragana, Katakana, CJK symbols
    (cp >= 0x3400 && cp <= 0x4dbf) || // CJK Ext A
    (cp >= 0x4e00 && cp <= 0x9fff) || // CJK Unified Ideographs
    (cp >= 0xa000 && cp <= 0xa4cf) || // Yi
    (cp >= 0xac00 && cp <= 0xd7a3) || // Hangul syllables
    (cp >= 0xf900 && cp <= 0xfaff) || // CJK compatibility ideographs
    (cp >= 0xfe30 && cp <= 0xfe4f) || // CJK compatibility forms
    (cp >= 0xff00 && cp <= 0xff60) || // fullwidth forms
    (cp >= 0xffe0 && cp <= 0xffe6) || // fullwidth signs
    (cp >= 0x1f300 && cp <= 0x1faff) || // emoji & symbols
    (cp >= 0x20000 && cp <= 0x3fffd) // CJK Ext B+ (supplementary ideographic)
  );
}

/** Width (in terminal cells) of a single code point. */
export function charWidth(cp: number): number {
  if (isZeroWidth(cp)) return 0;
  if (isWide(cp)) return 2;
  return 1;
}

/** Total display width (in terminal cells) of a string, ignoring ANSI sequences. */
export function cellWidth(s: string): number {
  let w = 0;
  for (const ch of stripAnsi(s)) {
    w += charWidth(ch.codePointAt(0) ?? 0);
  }
  return w;
}

/**
 * Take the longest prefix of `s` whose display width is <= `max` cells, plus the
 * remaining rest. Splits on code-point boundaries (never mid-surrogate), and
 * won't split a 2-wide char across the boundary (it goes wholly to the rest).
 * ANSI-bearing strings are not the target here; callers wrap plain text.
 */
export function sliceToWidth(s: string, max: number): { head: string; rest: string } {
  if (max <= 0) return { head: '', rest: s };
  let head = '';
  let w = 0;
  const chars = [...s]; // code-point iteration
  let i = 0;
  for (; i < chars.length; i++) {
    const cw = charWidth(chars[i]!.codePointAt(0) ?? 0);
    if (w + cw > max) break;
    head += chars[i];
    w += cw;
  }
  return { head, rest: chars.slice(i).join('') };
}
