import React from 'react';
import { Box, Text } from 'ink';
import { caretRowCol } from './input.js';

/**
 * Renders the prompt buffer with a block caret at `cursor`. The character under
 * the caret is shown inverse (a solid block when the caret sits at end-of-line),
 * and it blinks via `cursorOn`. Multi-line input (Shift+Enter) renders one row
 * per line with the caret on whichever line it falls.
 */
export function InputContent({
  value,
  cursor,
  cursorOn,
  accent,
}: {
  value: string;
  cursor: number;
  cursorOn: boolean;
  accent: string;
}) {
  if (value.length === 0) {
    return (
      <Box>
        <Text color={accent}>{cursorOn ? '█' : ' '}</Text>
        <Text dimColor>Send a message (/help for commands)</Text>
      </Box>
    );
  }
  const lines = value.split('\n');
  const { row: lineIdx, col: rem } = caretRowCol(value, cursor);
  return (
    <Box flexDirection="column">
      {lines.map((line, i) => {
        if (i !== lineIdx) {
          return (
            <Box key={i}>
              <Text>{line.length ? line : ' '}</Text>
            </Box>
          );
        }
        const under = line.slice(rem, rem + 1) || ' ';
        return (
          <Box key={i}>
            <Text>{line.slice(0, rem)}</Text>
            <Text color={accent} inverse={cursorOn}>
              {under}
            </Text>
            <Text>{line.slice(rem + 1)}</Text>
          </Box>
        );
      })}
    </Box>
  );
}
