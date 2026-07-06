#!/usr/bin/env node
// Preview + debug harness for the animated mascot.
//
//   npm run mascot                       # live loop (default theme), q/esc to quit
//   HANDOFF_THEME=ocean npm run mascot
//   NO_COLOR=1 npm run mascot            # monochrome, same motion
//   HANDOFF_REDUCED_MOTION=1 npm run mascot   # calm static frame
//
// Non-interactive inspection (no timers, exits immediately):
//   npm run mascot -- --snapshot mascot  # mid-hold frame of one object
//   npm run mascot -- --snapshot web|book|computer|brain|lightbulb|user
//   npm run mascot -- --frames 80 [--out /tmp/handoff-mascot.txt]

import React, { useRef } from 'react';
import { Box, Text, render, useApp, useInput } from 'ink';
import { writeFileSync } from 'fs';
import { getTheme } from '../config/theme.js';
import { bannerLines, LEFT_INNER, CANVAS_H } from '../ui/Banner.js';
import { useMorphMascot } from '../ui/useMorphMascot.js';
import { renderMorph, SHAPE_SEQUENCE, labelFor } from '../ui/ascii/AsciiMorphRenderer.js';
import type { ShapeName } from '../ui/ascii/shapes.js';
import type { Seg } from '../ui/ascii/colorize.js';
import { hexToRgb, rgbToHex, mix } from '../ui/color.js';

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const SEGMENT = 5000;
const PREVIEW_W = 62;
const PREVIEW_H = 24;

const snapshot = flag('--snapshot');
if (snapshot != null) {
  const idx = Math.max(0, SHAPE_SEQUENCE.indexOf(snapshot as ShapeName));
  const t = idx * SEGMENT + 1500;
  const frame = renderMorph({ width: PREVIEW_W, height: PREVIEW_H, timeMs: t });
  process.stdout.write(`# ${snapshot} (${labelFor(SHAPE_SEQUENCE[idx]!)})\n${frame.join('\n')}\n`);
  process.exit(0);
}

if (args.includes('--frames')) {
  const n = Number(flag('--frames')) || 80;
  const total = SHAPE_SEQUENCE.length * SEGMENT;
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const t = Math.round((i * total) / n);
    out.push(`--- frame ${i}  t=${t}ms ---`);
    out.push(renderMorph({ width: PREVIEW_W, height: PREVIEW_H, timeMs: t }).join('\n'));
  }
  const text = out.join('\n\n');
  const outPath = flag('--out');
  if (outPath) {
    writeFileSync(outPath, text, 'utf-8');
    process.stdout.write(`wrote ${n} frames → ${outPath}\n`);
  } else {
    process.stdout.write(text + '\n');
  }
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
  const base = rgbToHex(mix(hexToRgb(theme.mascot), [0, 0, 0], 0.22));
  const color = process.env['NO_COLOR'] == null;
  const reducedMotion = process.env['HANDOFF_REDUCED_MOTION'] != null;
  const visible = useRef(true);

  const big = useMorphMascot({ width: PREVIEW_W, height: PREVIEW_H, base, fps: 14, color, enabled: true, reducedMotion, visible });
  const inBanner = useMorphMascot({ width: LEFT_INNER, height: CANVAS_H, base, fps: 12, color, enabled: true, reducedMotion, visible });

  const banner = bannerLines({
    backend: 'ollama',
    modelId: 'qwen3:8b',
    theme,
    width: 84,
    mode: 'permissions',
    toolCount: 12,
    focus: 'research',
    project: 'Transformer Analysis',
    mascotRows: inBanner,
  });

  return (
    <Box flexDirection="column">
      {process.stdin.isTTY ? <QuitOnKey /> : null}
      <Text dimColor>mascot preview · theme {theme.name} · q/esc to quit · try --snapshot &lt;id&gt;</Text>
      <Rows rows={big} />
      <Text> </Text>
      <Box flexDirection="column">{banner}</Box>
    </Box>
  );
}

render(<Preview />);
