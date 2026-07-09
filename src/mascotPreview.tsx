#!/usr/bin/env node
// Preview + debug harness for the animated `h>` logo.
//
//   npm run mascot                       # live loop (default theme), q/esc to quit
//   HANDOFF_THEME=ocean npm run mascot
//   NO_COLOR=1 npm run mascot            # monochrome, same motion
//   HANDOFF_REDUCED_MOTION=1 npm run mascot   # calm static frame
//
// Non-interactive inspection (no timers, exits immediately):
//   npm run mascot -- --snapshot        # print the uncoloured logo grid
//   npm run mascot -- --snapshot 62 24  # at a given width/height

import React, { useRef } from 'react';
import { Box, Text, render, useApp, useInput } from 'ink';
import { getTheme } from '../config/theme.js';
import { bannerLines, LEFT_INNER, CANVAS_H } from '../ui/Banner.js';
import { useLogoAnimation } from '../ui/useLogoAnimation.js';
import { renderLogo, type Seg } from '../ui/ascii/logo.js';
import { themePalette } from '../ui/ascii/gradient.js';

const args = process.argv.slice(2);

const PREVIEW_W = 46;
const PREVIEW_H = 18;

const snapIdx = args.indexOf('--snapshot');
if (snapIdx >= 0) {
  const w = Number(args[snapIdx + 1]) || PREVIEW_W;
  const h = Number(args[snapIdx + 2]) || PREVIEW_H;
  process.stdout.write(`# h> logo ${w}x${h}\n${renderLogo(w, h).join('\n')}\n`);
  process.exit(0);
}

// ── interactive live preview ───────────────────────────────────────────────────

function QuitOnKey() {
  const { exit } = useApp();
  useInput((input, key) => {
    if (key.escape || input === 'q') exit();
  });
  return null;
}

function Rows({ rows }: { rows: Seg[][] }) {
  return (
    <Box flexDirection="column">
      {rows.map((segs, i) => (
        <Text key={i}>
          {segs.map((s, j) => (
            <Text key={j} color={s.color}>
              {s.text}
            </Text>
          ))}
        </Text>
      ))}
    </Box>
  );
}

function Preview() {
  const theme = getTheme(process.env['HANDOFF_THEME'] ?? 'aurora');
  const colors = themePalette(theme);
  const color = process.env['NO_COLOR'] == null;
  const reducedMotion = process.env['HANDOFF_REDUCED_MOTION'] != null;
  const visible = useRef(true);

  const big = useLogoAnimation({
    width: PREVIEW_W,
    height: PREVIEW_H,
    colors,
    fps: 20,
    color,
    enabled: true,
    reducedMotion,
    visible,
  });
  const inBanner = useLogoAnimation({
    width: LEFT_INNER,
    height: CANVAS_H,
    colors,
    fps: 20,
    color,
    enabled: true,
    reducedMotion,
    visible,
  });

  const banner = bannerLines({
    backend: 'ollama',
    modelId: 'qwen3:8b',
    theme,
    width: 110,
    mode: 'permissions',
    toolCount: 12,
    focus: 'research',
    project: 'Transformer Analysis',
    mascotRows: inBanner,
  });

  return (
    <Box flexDirection="column">
      {process.stdin.isTTY ? <QuitOnKey /> : null}
      <Text dimColor>h&gt; logo preview · theme {theme.name} · q/esc to quit · try --snapshot</Text>
      <Rows rows={big} />
      <Text> </Text>
      <Box flexDirection="column">{banner}</Box>
    </Box>
  );
}

render(<Preview />);
