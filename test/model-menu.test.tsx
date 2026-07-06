import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { useState } from 'react';
import { render } from 'ink-testing-library';
import { ModelMenu } from '../ui/ModelMenu.js';
import type { FavouriteEntry } from '../config/models.js';

/** A self-contained harness that owns favourites state, like App does. */
function Harness({ ollamaModels }: { ollamaModels?: string[] }) {
  const [favs, setFavs] = useState<FavouriteEntry[]>([]);
  return (
    <ModelMenu
      backend="ollama"
      vllmModels={[]}
      llamaCppModels={[]}
      mlxModels={[]}
      ollamaModels={ollamaModels}
      favourites={favs}
      currentModelId="qwen3:4b"
      onSelect={() => {}}
      onToggleFavourite={(id) =>
        setFavs((f) => {
          const i = f.findIndex((x) => x.modelId === id);
          return i === -1
            ? [...f, { backend: 'ollama' as const, modelId: id }]
            : f.filter((_, j) => j !== i);
        })
      }
    />
  );
}

const tick = (ms = 80) => new Promise((r) => setTimeout(r, ms));

test('pressing F on the focused model creates a Favourites section', async () => {
  const { lastFrame, stdin, unmount } = render(<Harness />);
  await tick();
  assert.ok(!(lastFrame() ?? '').includes('Favourites'), 'no favourites before F');
  stdin.write('f'); // cursor starts on the first model (qwen3:4b)
  await tick();
  const frame = lastFrame() ?? '';
  assert.ok(frame.includes('Favourites'), 'Favourites section appears after F');
  // The favourited model is shown with a star and moved into the section.
  assert.match(frame, /★ qwen3:4b/);
  unmount();
});

test('pressing F again removes the favourite', async () => {
  const { lastFrame, stdin, unmount } = render(<Harness />);
  await tick();
  stdin.write('f');
  await tick();
  assert.ok((lastFrame() ?? '').includes('Favourites'), 'added');
  stdin.write('f'); // cursor followed the model into Favourites; toggling removes it
  await tick();
  assert.ok(!(lastFrame() ?? '').includes('Favourites'), 'removed — section gone');
  unmount();
});

test('keyword hints start at the same column regardless of [badge]', async () => {
  const { lastFrame, unmount } = render(<Harness />);
  await tick();
  const lines = (lastFrame() ?? '').split('\n');
  // A row without a badge (qwen3:4b) and one with a badge (deepseek-r1:8b [adv]).
  const noBadge = lines.find((l) => l.includes('qwen3:4b') && l.includes('tiny'));
  const withBadge = lines.find((l) => l.includes('deepseek-r1:8b'));
  assert.ok(noBadge && withBadge, 'found both a badge-less and a badged row');
  // The hint keyword column must begin at the same index on both.
  const col1 = noBadge!.indexOf('tiny');
  const col2 = withBadge!.indexOf('reasoning');
  assert.equal(col1, col2, `hint columns should align (${col1} vs ${col2})`);
  unmount();
});

test('installed Ollama models get a Downloaded section', async () => {
  const { lastFrame, unmount } = render(<Harness ollamaModels={['gemma3:4b']} />);
  await tick();
  const frame = lastFrame() ?? '';
  assert.ok(frame.includes('Downloaded'), 'Downloaded section present');
  unmount();
});
