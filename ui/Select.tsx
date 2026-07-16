import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { Theme } from '../config/theme.js';

export interface SelectOption<T> {
  label: string;
  value: T;
  hint?: string;
  /** When true, renders as a non-selectable section heading; value is ignored. */
  separator?: boolean;
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
  const selectables = options.map((o, i) => (o.separator ? -1 : i)).filter((i) => i >= 0);
  const [index, setIndex] = useState(selectables[0] ?? 0);

  const move = (dir: 1 | -1) => {
    setIndex((cur) => {
      const pos = selectables.indexOf(cur);
      const next = selectables[(pos + dir + selectables.length) % selectables.length];
      return next ?? cur;
    });
  };

  useInput((_input, key) => {
    if (key.escape && onCancel) {
      onCancel();
    } else if (key.upArrow) {
      move(-1);
    } else if (key.downArrow) {
      move(1);
    } else if (key.return) {
      const opt = options[index];
      if (opt && !opt.separator) onSelect(opt.value);
    }
  });

  const accent = theme?.user ?? 'green';
  const heading = theme?.assistant ?? 'cyan';
  const section = theme?.border ?? 'cyan';

  const rows: React.ReactNode[] = [
    <Text key="top"> </Text>,
    <Text key="title" bold color={heading}>
      {'  '}
      {title}
    </Text>,
    <Text key="title-rule" color={heading} dimColor>
      {'  '}
      {'─'.repeat(title.length)}
    </Text>,
    <Text key="gap"> </Text>,
  ];

  options.forEach((opt, i) => {
    if (opt.separator) {
      rows.push(
        <Text key={`sep-${i}`} color={section} bold>
          {'  '}
          {opt.label.toUpperCase()}
        </Text>,
      );
      return;
    }

    const active = i === index;
    rows.push(
      <Text key={`opt-${i}`}>
        <Text color={active ? accent : undefined} bold={active}>
          {active ? '  ❯ ' : '    '}
        </Text>
        <Text color={active ? accent : undefined} bold={active} dimColor={!active}>
          {opt.label}
        </Text>
      </Text>,
    );
    // Hint shown only for the focused item.
    if (active && opt.hint) {
      rows.push(
        <Text key={`hint-${i}`} dimColor>
          {'      '}
          {opt.hint}
        </Text>,
      );
    }
    // One blank line after every option for breathing room.
    rows.push(<Text key={`gap-${i}`}> </Text>);
  });

  rows.push(
    <Text key="footer-gap"> </Text>,
    <Text key="footer" dimColor>
      {'  ↑↓ move  ·  ↵ select'}
      {onCancel ? '  ·  esc cancel' : ''}
    </Text>,
  );

  return <Box flexDirection="column">{rows}</Box>;
}
