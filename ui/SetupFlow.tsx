import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { writeStore } from '../config/store.js';

interface Props {
  onComplete: (token: string) => void;
  onCancel?: () => void;
}

export function SetupFlow({ onComplete, onCancel }: Props) {
  const [input, setInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useInput((char, key) => {
    if (saving) return;

    if (key.escape && onCancel) {
      onCancel();
      return;
    }

    if (key.return) {
      const token = input.trim();
      if (!token.startsWith('hf_')) {
        setError('Token must start with hf_');
        return;
      }
      setSaving(true);
      setError('');
      writeStore({ hfToken: token })
        .then(() => onComplete(token))
        .catch((err: unknown) => {
          setSaving(false);
          setError(err instanceof Error ? err.message : 'Failed to save token');
        });
    } else if (key.backspace || key.delete) {
      setInput((v) => v.slice(0, -1));
    } else if (char && !key.ctrl && !key.meta) {
      setInput((v) => v + char);
    }
  });

  return (
    <Box flexDirection="column" padding={2} gap={1}>
      <Text bold color="cyan">
        Welcome to Handoff
      </Text>
      <Text>Enter your HuggingFace token to get started.</Text>
      <Text dimColor>Get one at huggingface.co/settings/tokens</Text>

      <Box marginTop={1} flexDirection="column" gap={1}>
        <Text>HF Token:</Text>
        <Box borderStyle="round" paddingX={1}>
          <Text color="green">{saving ? 'Saving...' : input.replace(/./g, '*')}</Text>
          {!saving && (
            <Text color="green" dimColor>
              |
            </Text>
          )}
        </Box>
        {error && <Text color="red">{error}</Text>}
        <Text dimColor>Press Enter to confirm{onCancel ? ' · Esc to go back' : ''}</Text>
      </Box>
    </Box>
  );
}
