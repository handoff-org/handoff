import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { Theme } from '../config/theme.js';

interface Props {
  theme: Theme;
  /** Current value, used to prefill the field. */
  current: number;
  onSubmit: (numCtx: number) => void;
  onCancel: () => void;
}

const MIN_CTX = 512;

/**
 * Numeric field to set Ollama's context window (num_ctx). Digits only; Enter
 * confirms, Esc cancels. A larger window helps long tool-using conversations but
 * costs memory — on a small Mac too large a value forces CPU offload and slows
 * generation down, so the hint nudges the user to lower it if output is slow.
 */
export function ContextInput({ theme, current, onSubmit, onCancel }: Props) {
  const [value, setValue] = useState(String(current));
  const [error, setError] = useState('');

  const submit = () => {
    const n = Number(value);
    if (!Number.isFinite(n) || n < MIN_CTX) {
      setError(`Enter a number of at least ${MIN_CTX}.`);
      return;
    }
    onSubmit(Math.floor(n));
  };

  useInput((char, key) => {
    if (key.escape) return onCancel();
    if (key.return) return submit();
    // Some terminals deliver DEL as char '\x7f' without setting key.delete.
    if (key.backspace || key.delete || char === '\x7f') {
      setValue((v) => v.slice(0, -1));
      return;
    }
    if (char && !key.ctrl && !key.meta) {
      const digits = char.replace(/[^0-9]/g, '');
      if (digits) setValue((v) => (v + digits).slice(0, 7));
    }
  });

  return (
    <Box flexDirection="column" padding={1} gap={1}>
      <Text bold color={theme.note}>
        Context window (num_ctx)
      </Text>
      <Box flexDirection="column">
        <Text dimColor>Tokens Ollama keeps in memory for this model.</Text>
        <Text dimColor>Larger = better for long tool loops, but more memory.</Text>
        <Text dimColor>If output is slow, lower it (the model may be spilling to CPU).</Text>
      </Box>
      <Box borderStyle="round" borderColor={theme.borderActive} paddingX={1}>
        <Text>{value || ' '}</Text>
        <Text color={theme.user}>▏</Text>
      </Box>
      {error ? <Text color={theme.error}>{error}</Text> : null}
      <Text dimColor>Enter to save · Esc to cancel</Text>
    </Box>
  );
}
