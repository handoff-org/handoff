import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { render } from 'ink-testing-library';
import { ModelMenu } from '../ui/ModelMenu.js';

function frame(el: React.ReactElement): string {
  const { lastFrame } = render(el);
  return lastFrame() ?? '';
}

test('/model shows a hardware-aware suggestion line for Ollama', () => {
  const out = frame(
    <ModelMenu
      backend="ollama"
      vllmModels={[]}
      llamaCppModels={[]}
      mlxModels={[]}
      favourites={[]}
      currentModelId="qwen3:8b"
      performanceMode="cool"
      onSelect={() => {}}
      onToggleFavourite={() => {}}
    />,
  );
  // Hardware line + suggestion adapt to the host (Mac vs GPU PC vs CPU).
  assert.match(out, /Your (Mac|machine):/);
  assert.match(out, /Suggested for|➜/);
  assert.match(out, /perf mode: cool/);
});

test('/model shows hot/advanced badges on large models', () => {
  const out = frame(
    <ModelMenu
      backend="ollama"
      vllmModels={[]}
      llamaCppModels={[]}
      mlxModels={[]}
      favourites={[]}
      currentModelId="qwen3:8b"
      performanceMode="max"
      onSelect={() => {}}
      onToggleFavourite={() => {}}
    />,
  );
  // gpt-oss:120b / qwen3-coder-next are server-only and very hot.
  assert.match(out, /hot|server-only|advanced/);
});

test('/model on HuggingFace labels cloud models', () => {
  const out = frame(
    <ModelMenu
      backend="hf"
      vllmModels={[]}
      llamaCppModels={[]}
      mlxModels={[]}
      favourites={[]}
      currentModelId="Qwen/Qwen3-8B-Instruct"
      performanceMode="max"
      cloudConsent
      onSelect={() => {}}
      onToggleFavourite={() => {}}
    />,
  );
  assert.match(out, /cloud/i);
});
