import React from 'react';
import { Text } from 'ink';
import type { Theme } from '../config/theme.js';

/** Tokenize a single line into styled segments: **bold**, `code`, *italic*. */
export function renderInline(text: string, theme: Theme): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g;
  let last = 0;
  let k = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(<Text key={k++}>{text.slice(last, m.index)}</Text>);
    const tok = m[0];
    if (tok.startsWith('**')) {
      parts.push(
        <Text key={k++} bold>
          {tok.slice(2, -2)}
        </Text>,
      );
    } else if (tok.startsWith('`')) {
      parts.push(
        <Text key={k++} color={theme.tool}>
          {tok.slice(1, -1)}
        </Text>,
      );
    } else {
      parts.push(
        <Text key={k++} italic>
          {tok.slice(1, -1)}
        </Text>,
      );
    }
    last = m.index + tok.length;
  }
  if (last < text.length) parts.push(<Text key={k++}>{text.slice(last)}</Text>);
  return parts.length ? parts : [<Text key={0}> </Text>];
}

