import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALT_SCREEN_ON,
  ALT_SCREEN_OFF,
  INPUT_MODES_ON,
  INPUT_MODES_OFF,
  ENTER_ALT,
  EXIT_ALT,
  decPrivateModes,
} from '../ui/terminalControl.js';

test('alt-screen on/off toggle exactly mode 1049', () => {
  assert.deepEqual(decPrivateModes(ALT_SCREEN_ON), [{ mode: 1049, set: true }]);
  assert.deepEqual(decPrivateModes(ALT_SCREEN_OFF), [{ mode: 1049, set: false }]);
});

test('input modes on/off flip exactly the same set of modes (inverse pair)', () => {
  const on = decPrivateModes(INPUT_MODES_ON);
  const off = decPrivateModes(INPUT_MODES_OFF);
  const onMap = new Map(on.map((m) => [m.mode, m.set]));
  const offMap = new Map(off.map((m) => [m.mode, m.set]));
  assert.deepEqual([...onMap.keys()].sort(), [...offMap.keys()].sort(), 'same modes toggled');
  // Each mode is flipped to the opposite state on cleanup (true inverse pair).
  // Note: bracketed paste (2004) is DISABLED (l) on mount and re-ENABLED (h) on
  // cleanup, while alt-scroll (1007) is enabled then disabled — so this is a
  // per-mode inversion, not a uniform h→l.
  for (const [mode, set] of onMap) {
    assert.equal(offMap.get(mode), !set, `mode ${mode} must be inverted on cleanup`);
  }
  assert.deepEqual([...onMap.keys()].sort(), [1007, 2004]);
});

test('ownership does not overlap: input modes never touch the alt screen (1049)', () => {
  const inputModes = [...decPrivateModes(INPUT_MODES_ON), ...decPrivateModes(INPUT_MODES_OFF)].map(
    (m) => m.mode,
  );
  assert.ok(!inputModes.includes(1049), 'app.tsx input modes must not touch 1049');
  // And the alt-screen strings must not touch the input modes.
  const altModes = [...decPrivateModes(ALT_SCREEN_ON), ...decPrivateModes(ALT_SCREEN_OFF)].map(
    (m) => m.mode,
  );
  assert.ok(
    !altModes.includes(1007) && !altModes.includes(2004),
    'alt screen must not touch input modes',
  );
});

test('ENTER_ALT and EXIT_ALT are a matched pair', () => {
  assert.deepEqual(decPrivateModes(ENTER_ALT), [{ mode: 1049, set: true }]);
  assert.deepEqual(decPrivateModes(EXIT_ALT), [{ mode: 1049, set: false }]);
});
