import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { render } from 'ink-testing-library';
import { freshHome } from './helpers.js';

// Hold animations still and neutralize all network probes: App's mount effects
// fire fetches (model-install check, backend reachability). A never-resolving
// fetch leaves them pending harmlessly — no real network, no post-unmount
// setState, no unhandled rejection. HOME is isolated before importing App so its
// transitive module-load reads (PROJECTS_DIR etc.) hit the temp home.
process.env['HANDOFF_REDUCED_MOTION'] = '1';
const realFetch = globalThis.fetch;
globalThis.fetch = (() => new Promise(() => {})) as typeof fetch;

freshHome();
const { loadConfig } = await import('../config/schema.js');
const { ToolRegistry } = await import('../src/tools/registry.js');
const { registerBuiltins } = await import('../src/tools/builtin.js');
const { App } = await import('../ui/app.js');

function buildRegistry() {
  const r = new ToolRegistry();
  registerBuiltins(r);
  return r;
}

/**
 * Render App into ink-testing-library. Uses a server backend so the mount does
 * not enter the ollama "model prepare" screen, and always unmounts to clear any
 * timers/effects. Returns the final frame text.
 */
async function renderApp(): Promise<{ frame: string }> {
  const config = { ...(await loadConfig()), backend: 'llama_cpp' as const };
  const registry = buildRegistry();
  const inst = render(
    React.createElement(App, { initialConfig: config, registry, autoResume: false }),
  );
  // Let mount effects run a tick.
  await new Promise((r) => setTimeout(r, 20));
  const frame = inst.lastFrame() ?? '';
  inst.unmount();
  return { frame };
}

test('App mounts and renders a non-empty initial frame without crashing', async () => {
  const { frame } = await renderApp();
  assert.ok(frame.length > 0, 'initial frame should not be empty');
});

test('App initial frame shows the input prompt chrome', async () => {
  const { frame } = await renderApp();
  // The chat input box renders a leading prompt marker; assert some stable chat
  // chrome is present (guards against a render that silently drops the input).
  assert.ok(/[›>]/.test(frame), `expected a prompt marker in frame:\n${frame.slice(0, 400)}`);
});

// Restore the real fetch for any later test files in the same process.
test('teardown: restore fetch', () => {
  globalThis.fetch = realFetch;
});
