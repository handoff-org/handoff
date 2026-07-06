import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderLogo } from '../ui/ascii/logo.js';

test('renderLogo returns exactly height rows, each exactly width chars', () => {
  const rows = renderLogo(44, 24);
  assert.equal(rows.length, 24);
  for (const r of rows) assert.equal([...r].length, 44);
});

test('renderLogo draws ink (non-space block cells) and leaves margins', () => {
  const rows = renderLogo(44, 24);
  const ink = rows.join('').match(/[█▓]/g)?.length ?? 0;
  assert.ok(ink > 100, `expected a substantial glyph, got ${ink} ink cells`);
  // top and bottom rows are margin — no ink there.
  assert.equal(rows[0]!.trim(), '');
  assert.equal(rows[rows.length - 1]!.trim(), '');
});

test('renderLogo is deterministic', () => {
  assert.deepEqual(renderLogo(40, 20), renderLogo(40, 20));
});

test('the h stem sits left of the chevron tip (glyph is left-to-right h then >)', () => {
  const rows = renderLogo(60, 24);
  // Column of the first ink cell (the h stem) vs the last (the chevron tip).
  const firstCols: number[] = [];
  const lastCols: number[] = [];
  for (const r of rows) {
    const first = r.search(/[█▓]/);
    if (first < 0) continue;
    firstCols.push(first);
    lastCols.push(r.length - 1 - [...r].reverse().join('').search(/[█▓]/));
  }
  const stem = Math.min(...firstCols);
  const tip = Math.max(...lastCols);
  assert.ok(stem < tip, 'stem must be left of the chevron tip');
  assert.ok(tip - stem > 20, 'glyph should span most of the width');
});

test('renderLogo handles tiny canvases without throwing', () => {
  assert.doesNotThrow(() => renderLogo(1, 1));
  assert.equal(renderLogo(1, 1).length, 1);
});
