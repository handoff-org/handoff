import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import {
  isOllamaRunning,
  isModelInstalled,
  pullModel,
  startOllamaServe,
  ollamaModelsDir,
  type PullProgress,
} from '../src/agent/ollama.js';

interface Props {
  baseUrl: string;
  model: string;
  /** Server-startup perf flags, forwarded to startOllamaServe when we launch it. */
  flashAttention?: boolean;
  kvCacheType?: 'f16' | 'q8_0' | 'q4_0';
  onReady: () => void;
  onCancel?: () => void;
}

type Phase = 'checking' | 'starting' | 'not_running' | 'downloading' | 'error';

function pct(p: PullProgress): string {
  if (p.completed && p.total) {
    return ` ${Math.round((p.completed / p.total) * 100)}%`;
  }
  return '';
}

export function OllamaPrepare({
  baseUrl,
  model,
  flashAttention,
  kvCacheType,
  onReady,
  onCancel,
}: Props) {
  const [phase, setPhase] = useState<Phase>('checking');
  const [progress, setProgress] = useState<PullProgress | null>(null);
  const [error, setError] = useState('');

  useInput((_input, key) => {
    if (key.escape && onCancel) onCancel();
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!(await isOllamaRunning(baseUrl))) {
        if (!cancelled) setPhase('starting');
        startOllamaServe({ flashAttention, kvCacheType });
        let ready = false;
        for (let i = 0; i < 20; i++) {
          await new Promise((r) => setTimeout(r, 500));
          if (cancelled) return;
          if (await isOllamaRunning(baseUrl)) {
            ready = true;
            break;
          }
        }
        if (!ready) {
          if (!cancelled) setPhase('not_running');
          return;
        }
      }
      if (await isModelInstalled(baseUrl, model)) {
        if (!cancelled) onReady();
        return;
      }
      if (!cancelled) setPhase('downloading');
      try {
        await pullModel(baseUrl, model, (p) => {
          if (!cancelled) setProgress(p);
        });
        if (!cancelled) onReady();
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setPhase('error');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [baseUrl, model, flashAttention, kvCacheType, onReady]);

  if (phase === 'checking') {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="yellow">Checking Ollama…</Text>
        {onCancel && <Text dimColor>Esc to go back</Text>}
      </Box>
    );
  }

  if (phase === 'starting') {
    return (
      <Box flexDirection="column" padding={1} gap={1}>
        <Text color="yellow">Starting Ollama…</Text>
        <Text dimColor>Launching ollama serve in the background.</Text>
        {onCancel && <Text dimColor>Esc to go back</Text>}
      </Box>
    );
  }

  if (phase === 'not_running') {
    return (
      <Box flexDirection="column" padding={1} gap={1}>
        <Text color="red">Could not start Ollama at {baseUrl}.</Text>
        <Text dimColor>Make sure Ollama is installed, then try again.</Text>
        {onCancel && <Text dimColor>Esc to go back</Text>}
      </Box>
    );
  }

  if (phase === 'error') {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="red">Download failed:</Text>
        <Text>{error}</Text>
      </Box>
    );
  }

  // downloading
  return (
    <Box flexDirection="column" padding={1}>
      <Text color="yellow" bold>
        Downloading {model}…
      </Text>
      <Text>
        {progress?.status ?? 'starting'}
        {progress ? pct(progress) : ''}
      </Text>
      <Box marginTop={1} flexDirection="column">
        <Text dimColor>Models are stored in:</Text>
        <Text color="cyan"> {ollamaModelsDir()}</Text>
      </Box>
      {onCancel && <Text dimColor>Esc to go back</Text>}
    </Box>
  );
}
