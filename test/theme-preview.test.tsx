import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { render } from 'ink-testing-library';
import { ThemePreview } from '../ui/ThemePreview.js';
import { THEME_OPTIONS } from '../config/theme.js';

const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));

// Regression: flexWrap over bare <Text> chips threw
// "Text string must be rendered inside <Text> component". Each chip must be a Box.
test('ThemePreview renders and cycles every theme without throwing', async () => {
  let threw: Error | null = null;
  const { stdin, unmount } = render(
    <ThemePreview
      current="aurora"
      backend="ollama"
      modelId="qwen3:4b"
      onSelect={() => {}}
      onCancel={() => {}}
    />,
  );
  try {
    await tick();
    for (let i = 0; i < THEME_OPTIONS.length + 1; i++) {
      stdin.write('\x1b[C'); // right arrow → next theme, re-renders the banner preview
      await tick(15);
    }
  } catch (e) {
    threw = e as Error;
  }
  unmount();
  assert.equal(threw, null, threw ? `render threw: ${threw.message}` : 'ok');
});

test('there are at least a dozen themes to choose from', () => {
  assert.ok(THEME_OPTIONS.length >= 12, `expected 12+ themes, got ${THEME_OPTIONS.length}`);
});
