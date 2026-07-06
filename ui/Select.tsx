import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { Theme } from '../config/theme.js';

export interface SelectOption<T> {
  label: string;
  value: T;
  hint?: string;
}

interface Props<T> {
  title: string;
  options: SelectOption<T>[];
  onSelect: (value: T) => void;
  onCancel?: () => void;
  theme?: Theme;
}

/**
 * A borderless selection panel rendered directly on the terminal's own
 * background — no shading. (An earlier shaded-panel version left ragged
 * rectangles wherever a hint wrapped, since only the wrapped text carried the
 * background color.)
 */
export function Select<T>({ title, options, onSelect, onCancel, theme }: Props<T>) {
  const [index, setIndex] = useState(0);

  useInput((_input, key) => {
    if (key.escape && onCancel) {
      onCancel();
    } else if (key.upArrow) {
      setIndex((i) => (i - 1 + options.length) % options.length);
    } else if (key.downArrow) {
      setIndex((i) => (i + 1) % options.length);
    } else if (key.return) {
      const opt = options[index];
      if (opt) onSelect(opt.value);
    }
  });

  const accent = theme?.user ?? 'green';
  const heading = theme?.assistant ?? 'cyan';

  const blank = (key: string) => <Text key={key}> </Text>;

  const rows: React.ReactNode[] = [
    blank('top'),
    <Text key="title" bold color={heading}>
      {'  '}
      {title}
    </Text>,
    blank('gap'),
  ];

  options.forEach((opt, i) => {
    const active = i === index;
    const marker = active ? '  ❯ ' : '    ';
    rows.push(
      <Text key={`opt-${i}`} color={active ? accent : undefined} bold={active} dimColor={!active}>
        {marker}
        {opt.label}
      </Text>,
    );
    if (opt.hint) {
      rows.push(
        <Text key={`hint-${i}`} dimColor>
          {'      '}
          {opt.hint}
        </Text>,
      );
    }
    rows.push(blank(`optgap-${i}`));
  });

  rows.push(
    <Text key="footer" dimColor>
      {`  ↑/↓ navigate · Enter select${onCancel ? ' · Esc cancel' : ''}`}
    </Text>,
    blank('bottom'),
  );

  return <Box flexDirection="column">{rows}</Box>;
}
