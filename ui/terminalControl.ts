/**
 * Terminal control sequences, in one place, with explicit ownership.
 *
 * Two separate concerns write DEC private-mode sequences to stdout, and they
 * must NOT overlap or the terminal can be left in a broken state:
 *
 *  - The alternate screen buffer (`?1049h/l`) is owned SOLELY by src/index.tsx.
 *    It is entered before Ink mounts and left after Ink unmounts, because the
 *    post-quit session recap must print on the normal screen. If ui/app.tsx also
 *    toggled it, a double-restore (Ink unmount + app cleanup + process exit)
 *    could pop the alt screen twice and flicker/lose the recap.
 *
 *  - Input/scroll modes (alt-scroll `?1007h/l`, bracketed-paste `?2004h/l`) are
 *    owned SOLELY by ui/app.tsx, since they only matter while the TUI is live.
 *
 * Keeping the strings here (rather than inline) makes the split auditable and
 * unit-testable (see test/terminalControl.test.ts).
 */

// ── Alternate screen — owned by src/index.tsx ────────────────────────────────
export const ENTER_ALT = '\x1b[?1049h';
export const EXIT_ALT = '\x1b[?1049l';
export const CLEAR_AND_HOME = '\x1b[2J\x1b[H';

/** Written by index.tsx before Ink mounts: enter alt screen on a cleared canvas. */
export const ALT_SCREEN_ON = ENTER_ALT + CLEAR_AND_HOME;
/** Written by index.tsx after Ink unmounts. */
export const ALT_SCREEN_OFF = EXIT_ALT;

// ── Input / scroll modes — owned by ui/app.tsx ───────────────────────────────
export const ENTER_ALT_SCROLL = '\x1b[?1007h'; // wheel → arrow keys in alt buffer
export const EXIT_ALT_SCROLL = '\x1b[?1007l';
export const DISABLE_BRACKETED_PASTE = '\x1b[?2004l'; // pasted text arrives raw
export const ENABLE_BRACKETED_PASTE = '\x1b[?2004h';

/** Written by app.tsx on mount. */
export const INPUT_MODES_ON = ENTER_ALT_SCROLL + DISABLE_BRACKETED_PASTE;
/** Written by app.tsx on cleanup — inverse of INPUT_MODES_ON. */
export const INPUT_MODES_OFF = ENABLE_BRACKETED_PASTE + EXIT_ALT_SCROLL;

/**
 * Parse the DEC private modes toggled by a control string into
 * `{ mode, set }[]` (set=true for `h`, false for `l`). Used by tests to prove
 * the on/off strings flip exactly the same modes and that ownership doesn't
 * overlap.
 */
export function decPrivateModes(seq: string): Array<{ mode: number; set: boolean }> {
  const out: Array<{ mode: number; set: boolean }> = [];
  const re = /\x1b\[\?(\d+)([hl])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(seq)) !== null) {
    out.push({ mode: Number(m[1]), set: m[2] === 'h' });
  }
  return out;
}
