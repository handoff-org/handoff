import React from 'react';
import { Box, Text } from 'ink';
import {
  perimeterLength,
  topIndex,
  rightIndex,
  bottomIndex,
  leftIndex,
  beamBrightness,
  beamColorAt,
} from './beam.js';

const TAIL = 8;

/**
 * A rounded input-box border with a bright "beam" lapping the perimeter (Ink's
 * borderStyle paints the whole border one color, so it can't do this on its own).
 *
 * The top and bottom edges are drawn by hand — one <Text> per glyph — so the beam
 * can move across them a cell at a time in a lighter shade of `baseColor`. The two
 * vertical bars are delegated to Ink's per-side border (borderLeft/right with
 * per-side colors): Ink sizes them to the actual content height, so the box stays
 * intact even if the content wraps to more rows than expected. While the beam is on
 * a side, that whole bar lights up with the beam's peak color; on the long top and
 * bottom edges (where it spends most of the lap) the motion is smooth per-glyph.
 *
 * Layout mirrors the Ink box it replaces (paddingX={1}); every row is `width` wide.
 * `lines` is the content-row count, used only to size the perimeter so the beam's
 * speed accounts for the side lengths.
 */
export function BeamBox({
  width,
  lines,
  baseColor,
  phase,
  children,
}: {
  width: number;
  lines: number;
  baseColor: string;
  phase: number;
  children: React.ReactNode;
}) {
  const w = Math.max(4, Math.floor(width));
  const h = Math.max(1, Math.floor(lines));
  const P = perimeterLength(w, h);
  const head = phase * P;
  const color = (index: number) => beamColorAt(index, head, P, baseColor, TAIL);

  // Color a whole vertical bar with the peak (brightest) color of its cells, so the
  // beam appears to sweep onto the side as it passes any part of it.
  const edgeColor = (indexOf: (row: number) => number) => {
    let bestIdx = indexOf(0);
    let best = -1;
    for (let r = 0; r < h; r++) {
      const idx = indexOf(r);
      const b = beamBrightness(idx, head, P, TAIL);
      if (b > best) {
        best = b;
        bestIdx = idx;
      }
    }
    return color(bestIdx);
  };

  const topCells: React.ReactNode[] = [];
  const bottomCells: React.ReactNode[] = [];
  for (let c = 0; c < w; c++) {
    topCells.push(
      <Text key={c} color={color(topIndex(c))}>
        {c === 0 ? '╭' : c === w - 1 ? '╮' : '─'}
      </Text>,
    );
    bottomCells.push(
      <Text key={c} color={color(bottomIndex(w, h, c))}>
        {c === 0 ? '╰' : c === w - 1 ? '╯' : '─'}
      </Text>,
    );
  }

  return (
    <Box flexDirection="column" width={w}>
      <Text>{topCells}</Text>
      <Box
        borderStyle="round"
        borderTop={false}
        borderBottom={false}
        borderLeftColor={edgeColor((r) => leftIndex(w, h, r))}
        borderRightColor={edgeColor((r) => rightIndex(w, r))}
        paddingX={1}
        width={w}
      >
        {children}
      </Box>
      <Text>{bottomCells}</Text>
    </Box>
  );
}
