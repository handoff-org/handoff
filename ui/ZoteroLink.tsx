import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { Theme } from '../config/theme.js';
import { sanitizeTyped } from './input.js';

interface Props {
  theme: Theme;
  onSubmit: (apiKey: string, userId: string) => void;
  onCancel: () => void;
}

/**
 * Two-field form to link a Zotero library: the Web API key and the numeric user
 * id. Captured here and written straight to config so the key never passes
 * through the model or the chat transcript (mirrors OverleafLink).
 */
export function ZoteroLink({ theme, onSubmit, onCancel }: Props) {
  const [apiKey, setApiKey] = useState('');
  const [userId, setUserId] = useState('');
  const [focus, setFocus] = useState<0 | 1>(0);
  const [error, setError] = useState('');

  const submit = () => {
    if (!apiKey.trim()) {
      setError('Paste your Zotero Web API key.');
      setFocus(0);
      return;
    }
    if (!/^\d+$/.test(userId.trim())) {
      setError('The user id is the numeric library id shown on the API-keys page.');
      setFocus(1);
      return;
    }
    onSubmit(apiKey.trim(), userId.trim());
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
      if (focus === 0) setApiKey((v) => v.slice(0, -1));
      else setUserId((v) => v.slice(0, -1));
      return;
    }
    if (char && !key.ctrl && !key.meta) {
      const clean = sanitizeTyped(char);
      if (!clean) return;
      if (focus === 0) setApiKey((v) => v + clean);
      else setUserId((v) => v + clean);
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
        Connect your Zotero library
      </Text>
      <Box flexDirection="column">
        <Text dimColor>1. At zotero.org/settings/keys, create a key with library read/write.</Text>
        <Text dimColor>2. Copy the key and your numeric userID (shown on that page).</Text>
      </Box>
      {field('Zotero Web API key', apiKey, focus === 0, true)}
      {field('Numeric user id', userId, focus === 1)}
      {error ? <Text color={theme.error}>{error}</Text> : null}
      <Text dimColor>
        Tab to switch · Enter to {focus === 0 ? 'continue' : 'connect'} · Esc to cancel
      </Text>
    </Box>
  );
}
