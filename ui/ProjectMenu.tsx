import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { sanitizeTyped } from './input.js';
import { listProjects, type ProjectMeta } from '../src/workspace/project.js';
import type { Theme } from '../config/theme.js';

type View = 'list' | 'create' | 'confirm';

interface Props {
  theme: Theme;
  activeSlug?: string;
  onSwitch: (slug: string) => void;
  onCreate: (title: string) => void;
  onDelete: (slug: string) => void;
  onCancel: () => void;
}

/**
 * The /project menu: arrow through existing projects to switch, a trailing
 * "New project" row to create one (with a name field), and `d` to delete the
 * highlighted project after a confirmation. Always opens, even with no projects
 * yet, so creating one is discoverable.
 */
export function ProjectMenu({ theme, activeSlug, onSwitch, onCreate, onDelete, onCancel }: Props) {
  const [projects, setProjects] = useState<ProjectMeta[]>(() => listProjects());
  const [view, setView] = useState<View>('list');
  const [index, setIndex] = useState(0);
  const [name, setName] = useState('');

  const rowCount = projects.length + 1; // projects + the "New project" row
  const onNewRow = index >= projects.length;
  const current = onNewRow ? null : projects[index]!;

  useInput((char, key) => {
    if (view === 'create') {
      if (key.escape) {
        setView('list');
        setName('');
        return;
      }
      if (key.return) {
        const title = name.trim();
        if (title) onCreate(title);
        return;
      }
      if (key.backspace || key.delete) {
        setName((v) => v.slice(0, -1));
        return;
      }
      if (key.ctrl || key.meta) return;
      const clean = sanitizeTyped(char);
      if (clean) setName((v) => v + clean);
      return;
    }

    if (view === 'confirm') {
      if ((char === 'y' || char === 'Y') && current) {
        onDelete(current.slug);
        const next = listProjects();
        setProjects(next);
        setIndex(0);
        setView('list');
        return;
      }
      if (char === 'n' || char === 'N' || key.escape) setView('list');
      return;
    }

    // list view
    if (key.escape) return onCancel();
    if (key.upArrow) {
      setIndex((i) => (i - 1 + rowCount) % rowCount);
      return;
    }
    if (key.downArrow) {
      setIndex((i) => (i + 1) % rowCount);
      return;
    }
    if (key.return) {
      if (onNewRow) {
        setName('');
        setView('create');
      } else if (current) {
        onSwitch(current.slug);
      }
      return;
    }
    if ((char === 'd' || char === 'D') && current) setView('confirm');
  });

  if (view === 'create') {
    return (
      <Box flexDirection="column" padding={1} gap={1}>
        <Text bold color={theme.note}>
          New research project
        </Text>
        <Box borderStyle="round" borderColor={theme.borderActive} paddingX={1}>
          <Text color={theme.user}>› </Text>
          <Text>{name}</Text>
          <Text color={theme.user}>▏</Text>
        </Box>
        <Text dimColor>Type a project name · Enter to create · Esc to cancel</Text>
      </Box>
    );
  }

  if (view === 'confirm') {
    return (
      <Box flexDirection="column" padding={1} gap={1}>
        <Text bold color={theme.error}>
          Delete “{current?.slug}”?
        </Text>
        <Text dimColor>
          This permanently removes the project folder and everything in it — literature,
          experiments, runs, results, and the paper.
        </Text>
        <Text>
          <Text color={theme.error}>[y]</Text> delete{'   '}
          <Text color={theme.toolResult}>[n]</Text> cancel
        </Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color={theme.note}>
        Research projects
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {projects.map((p, i) => {
          const active = i === index;
          return (
            <Box key={p.slug}>
              <Text color={active ? theme.user : undefined} dimColor={!active}>
                {active ? '❯ ' : '  '}
                {p.slug}
                {p.slug === activeSlug ? '  (active)' : ''}
              </Text>
              {p.description ? (
                <Text dimColor>
                  {'  '}
                  {p.description}
                </Text>
              ) : null}
            </Box>
          );
        })}
        <Text color={onNewRow ? theme.user : undefined} dimColor={!onNewRow}>
          {onNewRow ? '❯ ' : '  '}➕ New project…
        </Text>
      </Box>
      <Text dimColor>
        {'\n'}↑/↓ navigate · Enter {onNewRow ? 'create' : 'open'} · {current ? 'd delete · ' : ''}
        Esc close
      </Text>
    </Box>
  );
}
