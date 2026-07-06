import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { useRef } from 'react';
import { Text } from 'ink';
import { render } from 'ink-testing-library';
import { useLogoAnimation } from '../ui/useLogoAnimation.js';

function Harness({ enabled, reducedMotion }: { enabled: boolean; reducedMotion?: boolean }) {
  const visible = useRef(true);
  const rows = useLogoAnimation({
    width: 36,
    height: 15,
    colors: ['#22c55e', '#22d3ee', '#d946ef'],
    fps: 20,
    color: false,
    enabled,
    reducedMotion,
    visible,
  });
  return <Text>{`rows=${rows.length}`}</Text>;
}

const tick = (ms = 25) => new Promise((r) => setTimeout(r, ms));

test('hook returns the canvas rows plus a label row', async () => {
  const { lastFrame, unmount } = render(<Harness enabled={false} />);
  await tick();
  assert.match(lastFrame() ?? '', /rows=16/); // 15 canvas + 1 label
  unmount();
});

test('animating starts an interval; disabled starts none; unmount clears it', async () => {
  const realSet = globalThis.setInterval;
  const realClear = globalThis.clearInterval;
  let sets = 0;
  let clears = 0;
  (globalThis as unknown as { setInterval: typeof setInterval }).setInterval = ((...a: unknown[]) => {
    sets++;
    return (realSet as (...x: unknown[]) => unknown)(...a);
  }) as typeof setInterval;
  (globalThis as unknown as { clearInterval: typeof clearInterval }).clearInterval = ((...a: unknown[]) => {
    clears++;
    return (realClear as (...x: unknown[]) => unknown)(...a);
  }) as typeof clearInterval;
  try {
    // Disabled: only ink's own baseline timers (if any), none from the hook.
    sets = 0;
    const off = render(<Harness enabled={false} />);
    await tick();
    const deltaOff = sets;
    off.unmount();

    // Reduced motion is also non-animating → same baseline as disabled.
    sets = 0;
    const rm = render(<Harness enabled={true} reducedMotion />);
    await tick();
    const deltaRm = sets;
    rm.unmount();

    // Enabled: the hook adds exactly one interval over the baseline.
    sets = 0;
    const on = render(<Harness enabled={true} />);
    await tick();
    const deltaOn = sets;
    const clearsBefore = clears;
    on.unmount();
    await tick(5);

    assert.equal(deltaRm, deltaOff, 'reduced motion must not start the hook interval');
    assert.ok(deltaOn > deltaOff, `enabled should start an interval (on=${deltaOn}, off=${deltaOff})`);
    assert.ok(clears > clearsBefore, 'unmount should clear the interval');
  } finally {
    globalThis.setInterval = realSet;
    globalThis.clearInterval = realClear;
  }
});
