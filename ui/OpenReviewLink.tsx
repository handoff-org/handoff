import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { Theme } from '../config/theme.js';
import { sanitizeTyped } from './input.js';

interface Props {
  theme: Theme;
  onSubmit: (username: string, password: string) => void;
  onCancel: () => void;
}

/**
 * Two-field form to link an OpenReview account: username (email or ~profile id)
 * and password. Captured here and written straight to config so credentials
 * never pass through the model or the chat transcript (mirrors ZoteroLink).
 */
export function OpenReviewLink({ theme, onSubmit, onCancel }: Props) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [focus, setFocus] = useState<0 | 1>(0);
  const [error, setError] = useState('');

  const submit = () => {
    if (!username.trim()) {
      setError('Enter your OpenReview email or ~profile id.');
      setFocus(0);
      return;
    }
    if (!password.trim()) {
      setError('Enter your OpenReview password.');
      setFocus(1);
      return;
    }
    onSubmit(username.trim(), password);
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
      if (focus === 0) setUsername((v) => v.slice(0, -1));
      else setPassword((v) => v.slice(0, -1));
      return;
    }
    if (char && !key.ctrl && !key.meta) {
      const clean = sanitizeTyped(char);
      if (!clean) return;
      if (focus === 0) setUsername((v) => v + clean);
      else setPassword((v) => v + clean);
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
        Connect your OpenReview account
      </Text>
      <Box flexDirection="column">
        <Text dimColor>Used to fetch your submissions and reviewer feedback (read-only).</Text>
        <Text dimColor>Stored locally in ~/.handoff/config.json — never sent to the model.</Text>
      </Box>
      {field('Email or ~profile id', username, focus === 0)}
      {field('Password', password, focus === 1, true)}
      {error ? <Text color={theme.error}>{error}</Text> : null}
      <Text dimColor>
        Tab to switch · Enter to {focus === 0 ? 'continue' : 'connect'} · Esc to cancel
      </Text>
    </Box>
  );
}
