import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { Box } from 'ink';
import { render } from 'ink-testing-library';
import { entryLines } from '../ui/lines.js';
import { bannerLines } from '../ui/Banner.js';
import { getTheme } from '../config/theme.js';
import type { ChatEntry } from '../ui/types.js';

const theme = getTheme('aurora');

/** Render a row list into a final terminal frame (plain text, colors stripped). */
function frameFor(nodes: React.ReactNode[]): string {
  const { lastFrame } = render(<Box flexDirection="column">{nodes}</Box>);
  return lastFrame() ?? '';
}

test('help panel renders a titled command box', () => {
  const frame = frameFor(entryLines({ kind: 'help' }, theme, 70, 'h'));
  assert.match(frame, /Commands/);
  assert.match(frame, /\/project/);
  assert.match(frame, /\/overleaf/);
  assert.match(frame, /╭/); // rounded box chrome
});

test('diff box shows the filename and +/- counts', () => {
  const entry: ChatEntry = {
    kind: 'diff',
    path: '/proj/paper/main.tex',
    rows: [
      { sign: '+', text: 'a new line' },
      { sign: '-', text: 'an old line' },
    ],
    added: 1,
    removed: 1,
    truncated: 0,
  };
  const frame = frameFor(entryLines(entry, theme, 70, 'd'));
  assert.match(frame, /main\.tex/);
  assert.match(frame, /\+1/);
  // The whole box is indented one "tab" past the chat margin.
  assert.match(frame, /^ {3}╭/m);
});

test('note renders as a borderless full-width block', () => {
  const frame = frameFor(entryLines({ kind: 'note', content: 'project → demo' }, theme, 70, 'n'));
  assert.match(frame, /project → demo/);
  assert.doesNotMatch(frame, /╭/); // no border chrome — shaded block instead
});

test('banner renders the masthead and getting-started panel', () => {
  const frame = frameFor(
    bannerLines({ backend: 'ollama', modelId: 'qwen2.5', theme, width: 90, mode: 'auto', toolCount: 7 }),
  );
  assert.match(frame, /handoff v/);
  assert.match(frame, /Getting started/);
  assert.match(frame, /qwen2\.5/);
});

test('banner reflects off-work (general) focus', () => {
  const frame = frameFor(
    bannerLines({
      backend: 'ollama',
      modelId: 'qwen2.5',
      theme,
      width: 90,
      mode: 'permissions',
      toolCount: 7,
      focus: 'general',
      project: 'My Paper',
    }),
  );
  // Off-work overrides the open project in the status line.
  assert.match(frame, /off-work/);
});
