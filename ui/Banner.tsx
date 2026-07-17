import React from 'react';
import { Text } from 'ink';
import { homedir, userInfo } from 'os';
import { spawnSync } from 'child_process';
import type { Theme } from '../config/theme.js';
import { hexToRgb, rgbToHex, mix } from './color.js';
import { renderLogo, labelRow, type Seg as MascotSeg } from './ascii/logo.js';
import { colorizeGradient, themePalette } from './ascii/gradient.js';

const VERSION = '0.1.0';

// inner width of the welcome card's left cell — the `h>` logo is rendered here
// at the art's native size (see ui/ascii/logoArt.ts), beside the info panel.
// Exported so the animation controller composites to exactly this width.
export const LEFT_INNER = 46;

// height (rows) of the logo canvas in the banner's left cell — the art's row
// count. A label row is drawn beneath it, so the left column is CANVAS_H + 1
// rows tall.
export const CANVAS_H = 18;

/** The user's first name, for the welcome line — git name, else OS user. */
const USER_NAME = ((): string => {
  try {
    const r = spawnSync('git', ['config', 'user.name'], { encoding: 'utf8' });
    const full = (r.stdout ?? '').trim();
    if (full) return full.split(/\s+/)[0]!;
  } catch {
    /* ignore */
  }
  try {
    return userInfo().username;
  } catch {
    return 'there';
  }
})();

export interface BannerInfo {
  backend: string;
  modelId: string;
  theme: Theme;
  width: number;
  mode: 'permissions' | 'auto';
  toolCount: number;
  /** Active research project title, if one is open. */
  project?: string;
  /** Work focus: 'general' is off-work (no project context). */
  focus?: 'research' | 'general';
  /**
   * External-account connection status for this session, shown in a "Connections"
   * monitor. Omit in preview contexts to hide the section.
   */
  connections?: { overleaf: boolean; zotero: boolean; openreview: boolean };
  /**
   * A frame of the animated mascot: LEFT_INNER-wide colored rows, one per mascot
   * line. When present (two-column layout only) it replaces the static mascot.
   */
  mascotRows?: MascotSeg[][];
}

function shortCwd(): string {
  const cwd = process.cwd();
  const home = homedir();
  return cwd.startsWith(home) ? '~' + cwd.slice(home.length) : cwd;
}

interface Seg {
  text: string;
  color?: string;
  dim?: boolean;
  bold?: boolean;
}

/** Truncate to a max display width, adding an ellipsis when it doesn't fit. */
function clip(s: string, max: number): string {
  if (max <= 0) return '';
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

interface PanelRow {
  segs: Seg[];
  center?: boolean;
}

/**
 * The banner: a single full-width box, split by a vertical divider into a
 * welcome card (left) and a getting-started panel (right), with command hints
 * below. Falls back to one column on narrow terminals. Lives in the transcript.
 */
export function bannerLines(info: BannerInfo): React.ReactNode[] {
  const {
    backend,
    modelId,
    theme,
    width,
    mode,
    toolCount,
    project,
    focus,
    connections,
    mascotRows,
  } = info;
  const mascotColor = rgbToHex(mix(hexToRgb(theme.mascot), [0, 0, 0], 0.22));
  const border = theme.border;
  // One accent throughout, so the masthead reads as a single, intentional voice
  // rather than a scatter of theme colors.
  const accent = mascotColor;
  const out: React.ReactNode[] = [];

  // Render segments into a fixed-width cell (clip, then pad / centre).
  const cell = (segs: Seg[], innerW: number, center: boolean, kb: string): React.ReactNode[] => {
    let budget = innerW;
    const fitted: Seg[] = [];
    for (const s of segs) {
      if (budget <= 0) break;
      const text = s.text.length > budget ? clip(s.text, budget) : s.text;
      fitted.push({ ...s, text });
      budget -= text.length;
    }
    const used = fitted.reduce((n, s) => n + s.text.length, 0);
    const slack = Math.max(0, innerW - used);
    const left = center ? Math.floor(slack / 2) : 0;
    const right = slack - left;
    const nodes: React.ReactNode[] = [];
    if (left) nodes.push(<Text key={`${kb}-pl`}>{' '.repeat(left)}</Text>);
    fitted.forEach((s, j) =>
      nodes.push(
        <Text key={`${kb}-s${j}`} color={s.color} dimColor={s.dim} bold={s.bold}>
          {s.text}
        </Text>,
      ),
    );
    if (right) nodes.push(<Text key={`${kb}-pr`}>{' '.repeat(right)}</Text>);
    return nodes;
  };

  // The one-line status of where you're working right now.
  const focusText = focus === 'general' ? 'off-work · general' : (project ?? 'no project open');

  // Left column: the `h>` logo canvas + a label beneath it. When no animation
  // frame is supplied (disabled / reduced-motion / non-tty), render a calm static
  // frame (phase 0) the same way, so the layout is identical either way.
  const noColor = process.env['NO_COLOR'] != null;
  const canvasRows: MascotSeg[][] =
    mascotRows ??
    (() => {
      const palette = themePalette(theme);
      const frame = colorizeGradient(renderLogo(LEFT_INNER, CANVAS_H), palette, 0, {
        color: !noColor,
      });
      frame.push(labelRow('', LEFT_INNER, palette[0]!, !noColor));
      return frame;
    })();
  const logoPanelRows: PanelRow[] = canvasRows.map((segs): PanelRow => ({ segs, center: true }));

  // Right column: welcome + where-you're-working, then getting-started and
  // shortcuts. Generous blank gaps between the four groups let the panel
  // breathe and fill the height of the taller mascot canvas beside it.
  const cmd = (c: string, desc: string): PanelRow => ({
    segs: [
      { text: c.padEnd(15), color: accent },
      { text: desc, dim: true },
    ],
  });
  const blank: PanelRow = { segs: [] };
  // "Connections" monitor: a filled dot for a linked account, hollow for not.
  const dot = (label: string, ok: boolean): Seg[] => [
    { text: ok ? '●' : '○', color: ok ? accent : undefined, dim: !ok },
    { text: ` ${label}  `, dim: true },
  ];
  const connRows: PanelRow[] = connections
    ? [
        blank,
        { segs: [{ text: 'Connections', color: accent, bold: true }] },
        { segs: [...dot('Overleaf', connections.overleaf), ...dot('Zotero', connections.zotero)] },
        { segs: dot('OpenReview', connections.openreview) },
      ]
    : [];
  const infoRows: PanelRow[] = [
    { segs: [{ text: `Welcome back, ${USER_NAME}`, color: accent, bold: true }] },
    { segs: [{ text: 'local-first research', dim: true }] },
    blank,
    blank,
    blank,
    { segs: [{ text: modelId }, { text: `  ${backend}`, dim: true }] },
    {
      segs: [
        { text: mode === 'auto' ? 'hands-off' : 'hands-on', dim: true },
        { text: '  ·  ', dim: true },
        { text: focusText, color: focus === 'general' ? theme.tool : accent },
      ],
    },
    { segs: [{ text: shortCwd(), dim: true }] },
    ...connRows,
    blank,
    blank,
    blank,
    { segs: [{ text: 'Getting started', color: accent, bold: true }] },
    cmd('/project new', 'start a study'),
    cmd('/research', 'check the lit'),
    cmd('/overleaf', 'sync Overleaf'),
  ];
  void toolCount;

  // Vertically centre the logo against the (taller) info panel so it sits in the
  // middle of the left cell rather than stuck to the top.
  const vpad = Math.max(0, Math.floor((infoRows.length - logoPanelRows.length) / 2));
  const mascotPanelRows: PanelRow[] = [...new Array<PanelRow>(vpad).fill(blank), ...logoPanelRows];

  const outerW = Math.max(24, width);
  const title = ` handoff v${VERSION} `;
  const leftInner = LEFT_INNER;
  const dividerCol = leftInner + 3; // column of the inner │ within each line
  const rightInner = outerW - 7 - leftInner; // 7 = borders + 3 padding spaces
  // Two columns only when the info panel has room for its longest line
  // (~32 cols: "hands-on · off-work · general"); otherwise stack to one column
  // (info full-width) rather than clipping. With the ~0.8× logo this needs a
  // fairly wide terminal (~101 cols); narrower falls back cleanly.
  const twoCol = rightInner >= 32;

  if (twoCol) {
    // Top border with title and a ┬ where the divider meets it.
    out.push(
      <Text key="b-top">
        <Text color={border}>╭─</Text>
        <Text color={accent} bold>
          {title}
        </Text>
        <Text color={border}>
          {'─'.repeat(dividerCol - 2 - title.length) +
            '┬' +
            '─'.repeat(outerW - dividerCol - 2) +
            '╮'}
        </Text>
      </Text>,
    );
    const n = Math.max(mascotPanelRows.length, infoRows.length);
    for (let i = 0; i < n; i++) {
      const l = mascotPanelRows[i] ?? { segs: [] };
      const r = infoRows[i] ?? { segs: [] };
      out.push(
        <Text key={`b-r${i}`}>
          <Text color={border}>│ </Text>
          {cell(l.segs, leftInner, l.center ?? false, `l${i}`)}
          <Text color={border}> │ </Text>
          {cell(r.segs, rightInner, false, `r${i}`)}
          <Text color={border}> │</Text>
        </Text>,
      );
    }
    out.push(
      <Text key="b-bot" color={border}>
        {'╰' + '─'.repeat(dividerCol - 1) + '┴' + '─'.repeat(outerW - dividerCol - 2) + '╯'}
      </Text>,
    );
  } else {
    // Single-column fallback: the info panel only (the 3D mascot needs the width).
    const innerW = Math.max(4, outerW - 4);
    out.push(
      <Text key="b-top">
        <Text color={border}>╭─</Text>
        <Text color={accent} bold>
          {title}
        </Text>
        <Text color={border}>{'─'.repeat(Math.max(0, outerW - 3 - title.length)) + '╮'}</Text>
      </Text>,
    );
    infoRows.forEach((row, i) =>
      out.push(
        <Text key={`b-r${i}`}>
          <Text color={border}>│ </Text>
          {cell(row.segs, innerW, row.center ?? false, `s${i}`)}
          <Text color={border}> │</Text>
        </Text>,
      ),
    );
    out.push(
      <Text key="b-bot" color={border}>
        {'╰' + '─'.repeat(Math.max(0, outerW - 2)) + '╯'}
      </Text>,
    );
  }

  // Command hints, below the banner.
  const cmds = ['/help', '/project', '/overleaf', '/zotero', '↑↓ scroll'];
  const hints: Seg[] = [{ text: '  ' }];
  cmds.forEach((c, i) => {
    if (i) hints.push({ text: '   ', dim: true });
    hints.push(c.startsWith('/') ? { text: c, color: accent } : { text: c, dim: true });
  });
  out.push(
    <Text key="b-hints">
      {hints.map((s, i) => (
        <Text key={i} color={s.color} dimColor={s.dim}>
          {s.text}
        </Text>
      ))}
    </Text>,
  );
  return out;
}
