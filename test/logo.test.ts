import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderLogo } from '../ui/ascii/logo.js';
import { LOGO_ART, LOGO_ART_WIDTH, LOGO_ART_HEIGHT } from '../ui/ascii/logoArt.js';

test('renderLogo returns exactly height rows, each exactly width chars', () => {
  const rows = renderLogo(44, 24);
  assert.equal(rows.length, 24);
  for (const r of rows) assert.equal([...r].length, 44);
});

test('renderLogo draws the fixed art ink cells', () => {
  const rows = renderLogo(LOGO_ART_WIDTH, LOGO_ART_HEIGHT);
  const ink = rows.join('').match(/0/g)?.length ?? 0;
  assert.ok(ink > 100, `expected a substantial glyph, got ${ink} ink cells`);
  // At full size, the render is the art verbatim (padded to width).
  assert.equal(rows.length, LOGO_ART_HEIGHT);
  assert.equal(rows[0]!.trimEnd(), LOGO_ART[0]!.trimEnd());
});

test('renderLogo is deterministic', () => {
  assert.deepEqual(renderLogo(40, 20), renderLogo(40, 20));
});

test('the h stem sits left of the chevron tip (glyph is left-to-right h then >)', () => {
  const rows = renderLogo(LOGO_ART_WIDTH, LOGO_ART_HEIGHT);
  const firstCols: number[] = [];
  const lastCols: number[] = [];
  for (const r of rows) {
    const first = r.search(/0/);
    if (first < 0) continue;
    firstCols.push(first);
    lastCols.push(r.length - 1 - [...r].reverse().join('').search(/0/));
  }
  const stem = Math.min(...firstCols);
  const tip = Math.max(...lastCols);
  assert.ok(stem < tip, 'stem must be left of the chevron tip');
  assert.ok(tip - stem > 20, 'glyph should span most of the width');
});

test('renderLogo resamples the whole glyph to the requested size', () => {
  const small = renderLogo(40, 14); // ~0.5×
  assert.equal(small.length, 14);
  for (const r of small) assert.equal(r.length, 40);
  // The full glyph survives the downscale — ink in the left (h) and right (chevron) halves.
  const leftInk = small.some((r) => r.slice(0, 20).includes('0'));
  const rightInk = small.some((r) => r.slice(20).includes('0'));
  assert.ok(leftInk && rightInk, 'both the h and the chevron should scale down intact');
});

test('renderLogo handles tiny canvases without throwing', () => {
  assert.doesNotThrow(() => renderLogo(1, 1));
  assert.equal(renderLogo(1, 1).length, 1);
});
