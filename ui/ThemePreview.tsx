import React, { useState } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import { bannerLines } from './Banner.js';
import { THEME_OPTIONS, getTheme } from '../config/theme.js';

interface Props {
  current: string;
  backend: string;
  modelId: string;
  mode?: 'permissions' | 'auto';
  onSelect: (name: string) => void;
  onCancel: () => void;
}

export function ThemePreview({ current, backend, modelId, mode = 'permissions', onSelect, onCancel }: Props) {
  const { stdout } = useStdout();
  const initial = Math.max(
    0,
    THEME_OPTIONS.findIndex((o) => o.value === current),
  );
  const [index, setIndex] = useState(initial);

  useInput((_input, key) => {
    if (key.leftArrow || key.upArrow) {
      setIndex((i) => (i - 1 + THEME_OPTIONS.length) % THEME_OPTIONS.length);
    } else if (key.rightArrow || key.downArrow) {
      setIndex((i) => (i + 1) % THEME_OPTIONS.length);
    } else if (key.return) {
      onSelect(THEME_OPTIONS[index]!.value);
    } else if (key.escape) {
      onCancel();
    }
  });

  const focused = THEME_OPTIONS[index]!.value;
  const focusedTheme = getTheme(focused);

  return (
    <Box flexDirection="column">
      <Box flexDirection="column">
        {bannerLines({ backend, modelId, theme: focusedTheme, width: stdout.columns ?? 80, mode, toolCount: 0 })}
      </Box>

      <Box paddingX={1} marginTop={1} flexWrap="wrap">
        {THEME_OPTIONS.map((o, i) => {
          const active = i === index;
          // Each chip is its own Box so flexWrap can wrap them across rows.
          // (flexWrap over bare <Text> items throws in Ink.)
          return (
            <Box key={o.value}>
              <Text
                bold={active}
                color={active ? getTheme(o.value).borderActive : undefined}
                dimColor={!active}
              >
                {active ? `[ ${o.label} ]` : `  ${o.label}  `}
              </Text>
            </Box>
          );
        })}
      </Box>

      <Box paddingX={1}>
        <Text dimColor>←/→ preview · Enter to apply · Esc to cancel</Text>
      </Box>
    </Box>
  );
}
