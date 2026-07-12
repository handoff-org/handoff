import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { Theme } from '../config/theme.js';
import { parseProjectId } from '../src/workspace/overleaf.js';
import { sanitizeTyped } from './input.js';

interface Props {
  theme: Theme;
  onSubmit: (url: string, token: string) => void;
  onCancel: () => void;
}

/** Two-field form to paste an Overleaf project link and a Git token. */
export function OverleafLink({ theme, onSubmit, onCancel }: Props) {
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [focus, setFocus] = useState<0 | 1>(0);
  const [error, setError] = useState('');

  const submit = () => {
    if (!parseProjectId(url.trim())) {
      setError('That link doesn’t look like an Overleaf project (…overleaf.com/project/…).');
      setFocus(0);
      return;
    }
    if (!token.trim()) {
      setError('Paste your Git authentication token.');
      setFocus(1);
      return;
    }
    onSubmit(url.trim(), token.trim());
  };

  useInput((char, key) => {
    if (key.escape) return onCancel();
    if (key.tab || key.downArrow || key.upArrow) {
      setFocus((f) => (f === 0 ? 1 : 0));
      return;
    }
    if (key.return) {
      if (focus === 0) setFocus(1);
      else submit();
      return;
    }
    if (key.backspace || key.delete) {
      if (focus === 0) setUrl((v) => v.slice(0, -1));
      else setToken((v) => v.slice(0, -1));
      return;
    }
    if (char && !key.ctrl && !key.meta) {
      const clean = sanitizeTyped(char);
      if (!clean) return;
      if (focus === 0) setUrl((v) => v + clean);
      else setToken((v) => v + clean);
    }
  });

  const field = (label: string, value: string, active: boolean, masked = false) => (
    <Box flexDirection="column">
      <Text color={active ? theme.user : undefined} dimColor={!active}>
        {label}
      </Text>
      <Box
        borderStyle="round"
        borderColor={active ? theme.borderActive : theme.border}
        paddingX={1}
      >
        <Text>{masked ? value.replace(/./g, '•') : value || ' '}</Text>
        {active && <Text color={theme.user}>▏</Text>}
      </Box>
    </Box>
  );

  return (
    <Box flexDirection="column" padding={1} gap={1}>
      <Text bold color={theme.note}>
        Connect this project to Overleaf
      </Text>
      <Box flexDirection="column">
        <Text dimColor>1. In Overleaf, open your project and copy its web link.</Text>
        <Text dimColor>
          2. Account Settings → Git Integration → Create Token, and paste it below.
        </Text>
      </Box>
      {field('Overleaf project link', url, focus === 0)}
      {field('Git authentication token', token, focus === 1, true)}
      {error ? <Text color={theme.error}>{error}</Text> : null}
      <Text dimColor>
        Tab to switch · Enter to {focus === 0 ? 'continue' : 'connect'} · Esc to cancel
      </Text>
    </Box>
  );
}
