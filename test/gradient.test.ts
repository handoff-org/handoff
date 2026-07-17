import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sampleCycle, colorizeGradient, themePalette } from '../ui/ascii/gradient.js';
import { getTheme, THEMES } from '../config/theme.js';

test('sampleCycle wraps seamlessly (t and t+1 give the same colour)', () => {
  const colors = ['#ff0000', '#00ff00', '#0000ff'];
  assert.equal(sampleCycle(colors, 0), sampleCycle(colors, 1));
  assert.equal(sampleCycle(colors, 0.25), sampleCycle(colors, 1.25));
});

test('sampleCycle hits each stop at its ring position', () => {
  const colors = ['#ff0000', '#00ff00', '#0000ff'];
  assert.equal(sampleCycle(colors, 0), '#ff0000');
  assert.equal(sampleCycle(colors, 1 / 3), '#00ff00');
  assert.equal(sampleCycle(colors, 2 / 3), '#0000ff');
});

test('sampleCycle blends between stops (midpoint is neither endpoint)', () => {
  const mid = sampleCycle(['#000000', '#ffffff', '#000000'], 1 / 6);
  assert.notEqual(mid, '#000000');
  assert.notEqual(mid, '#ffffff');
});

test('colorizeGradient colours ink by column and leaves spaces uncoloured', () => {
  const rows = ['  ██  ', '  ██  '];
  const segs = colorizeGradient(rows, ['#ff0000', '#00ff00', '#0000ff'], 0, { color: true });
  const colored = segs[0]!.filter((s) => s.color);
  assert.ok(colored.length >= 1, 'ink should be coloured');
  // Leading spaces are a single uncoloured run.
  assert.equal(segs[0]![0]!.color, undefined);
});

test('colorizeGradient under NO_COLOR emits no colours', () => {
  const segs = colorizeGradient(['██'], ['#ff0000', '#00ff00', '#0000ff'], 0, { color: false });
  assert.ok(segs[0]!.every((s) => s.color === undefined));
});

test('advancing phase changes the colour assigned to a column', () => {
  const rows = ['████████'];
  const a = colorizeGradient(rows, ['#ff0000', '#00ff00', '#0000ff'], 0, { color: true });
  const b = colorizeGradient(rows, ['#ff0000', '#00ff00', '#0000ff'], 0.5, { color: true });
  assert.notDeepEqual(a, b, 'a phase shift should recolour the sweep');
});

test('themePalette yields at least three distinct colours for every theme', () => {
  for (const name of Object.keys(THEMES)) {
    const pal = themePalette(getTheme(name));
    assert.ok(pal.length >= 3, `${name} palette too short`);
    assert.equal(
      new Set(pal.map((c) => c.toLowerCase())).size,
      pal.length,
      `${name} palette has dupes`,
    );
  }
});
