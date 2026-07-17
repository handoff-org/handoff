import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { execFileSync, spawnSync } from 'child_process';
import { chmodSync, existsSync, mkdirSync } from 'fs';
import { sanitizeTyped } from './input.js';
import type { Theme } from '../config/theme.js';
import type { Config } from '../config/schema.js';
import { registerAccount } from '../src/network/relayClient.js';

interface Props {
  theme: Theme;
  config: Config;
  peerCredits: number | null;
  onRegister: (token: string, balance: number) => void;
  onToggle: (enabled: boolean) => void;
  onCancel: () => void;
}

type Phase =
  'landing' | 'registering' | 'confirmed' | 'enter_token' | 'menu' | 'installing' | 'downloading';

function servePath(): string | null {
  try {
    return execFileSync('which', ['handoff-serve'], { encoding: 'utf8' }).trim() || null;
  } catch {
    return null;
  }
}

function isServiceInstalled(): boolean {
  const home = process.env['HOME'] ?? '';
  return existsSync(`${home}/Library/LaunchAgents/sh.handoff.serve.plist`);
}

export function PeerSetup({ theme, config, peerCredits, onRegister, onToggle, onCancel }: Props) {
  const hasToken = !!config.peerToken;
  const [phase, setPhase] = useState<Phase>(hasToken ? 'menu' : 'landing');
  const [landingIdx, setLandingIdx] = useState(0);
  const [menuIdx, setMenuIdx] = useState(0);
  const [tokenInput, setTokenInput] = useState('');
  const [tokenError, setTokenError] = useState('');
  const [registerError, setRegisterError] = useState('');
  const [installError, setInstallError] = useState('');
  const [serveBin, _setServeBin] = useState<string | null>(() => servePath());

  const landingOptions = ['Get started (free)', 'I already have a token', 'Cancel'];

  const serviceOn = isServiceInstalled();
  const menuOptions = [
    config.peerNetworkEnabled ? 'Disable peer network' : 'Enable peer network',
    serviceOn
      ? 'GPU sharing  ·  active  (background service)'
      : 'Share my GPU when idle  (earn tokens)',
    'Copy my token',
    'Done',
  ];

  useInput((char, key) => {
    if (key.escape) {
      onCancel();
      return;
    }

    if (phase === 'landing') {
      if (key.upArrow)
        setLandingIdx((i) => (i + landingOptions.length - 1) % landingOptions.length);
      if (key.downArrow) setLandingIdx((i) => (i + 1) % landingOptions.length);
      if (key.return) {
        if (landingIdx === 0) {
          setPhase('registering');
          void doRegister();
        } else if (landingIdx === 1) {
          setPhase('enter_token');
        } else {
          onCancel();
        }
      }
      return;
    }

    if (phase === 'registering' || phase === 'installing') return;

    if (phase === 'confirmed') {
      if (key.return) onCancel();
      return;
    }

    if (phase === 'enter_token') {
      if (key.return) {
        const t = tokenInput.trim();
        if (!t) {
          setTokenError('Paste your token here.');
          return;
        }
        onRegister(t, 0);
        return;
      }
      if (key.backspace || key.delete || char === '\x7f') {
        setTokenInput((v) => v.slice(0, -1));
        return;
      }
      if (char && !key.ctrl && !key.meta) {
        const c = sanitizeTyped(char);
        if (c) setTokenInput((v) => (v + c).slice(0, 128));
      }
      return;
    }

    if (phase === 'menu') {
      if (key.upArrow) setMenuIdx((i) => (i + menuOptions.length - 1) % menuOptions.length);
      if (key.downArrow) setMenuIdx((i) => (i + 1) % menuOptions.length);
      if (key.return) handleMenuPick(menuIdx);
      return;
    }
  });

  async function doRegister() {
    setRegisterError('');
    const result = await registerAccount(config.peerRelayUrl);
    if (!result) {
      setRegisterError('Relay unreachable — check your internet connection.');
      setPhase('landing');
      return;
    }
    onRegister(result.token, result.balance);
    setPhase('confirmed');
  }

  async function downloadServe(): Promise<string | null> {
    const plat = process.platform === 'darwin' ? 'darwin' : 'linux';
    const archStr = process.arch === 'arm64' ? 'arm64' : 'amd64';
    const asset = `handoff-serve-${plat}-${archStr}`;
    const url = `https://github.com/handoff-org/handoff-relay/releases/latest/download/${asset}`;
    const home = process.env['HOME'] ?? '';
    const dir = `${home}/.local/bin`;
    const dest = `${dir}/handoff-serve`;
    try {
      mkdirSync(dir, { recursive: true });
      execFileSync('curl', ['-fsSL', url, '-o', dest]);
      chmodSync(dest, 0o755);
      return dest;
    } catch {
      return null;
    }
  }

  async function doInstallServe() {
    setInstallError('');
    let bin = serveBin;
    if (!bin) {
      setPhase('downloading');
      bin = await downloadServe();
      if (!bin) {
        setInstallError('Download failed — check your internet connection and try again.');
        setPhase('menu');
        return;
      }
    }
    setPhase('installing');
    const result = spawnSync(bin, ['--token', config.peerToken ?? '', '--install-service'], {
      stdio: 'pipe',
    });
    if (result.status !== 0) {
      setInstallError(
        result.stderr?.toString().trim() ||
          'Install failed — try running with sudo or check permissions.',
      );
    }
    setPhase('menu');
  }

  function copyToken() {
    const token = config.peerToken ?? '';
    try {
      const proc = spawnSync('pbcopy', { input: token });
      if (proc.status !== 0) throw new Error();
    } catch {
      try {
        spawnSync('xclip', ['-selection', 'clipboard'], { input: token });
      } catch {
        /* clipboard unavailable */
      }
    }
  }

  function handleMenuPick(idx: number) {
    switch (idx) {
      case 0:
        onToggle(!config.peerNetworkEnabled);
        break;
      case 1:
        if (!serviceOn) void doInstallServe();
        break;
      case 2:
        copyToken();
        break;
      default:
        onCancel();
    }
  }

  const accent = theme.user;

  if (phase === 'landing') {
    return (
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Text bold color={accent}>
          Join the handoff GPU network
        </Text>
        <Text> </Text>
        <Text dimColor>Run inference on community GPUs when your local model is unavailable.</Text>
        <Text dimColor>First 50,000 tokens free — no credit card, no sign-up form.</Text>
        <Text> </Text>
        {registerError ? <Text color={theme.error}>⚠ {registerError}</Text> : null}
        {landingOptions.map((opt, i) => (
          <Text key={opt} color={i === landingIdx ? accent : undefined}>
            {i === landingIdx ? '❯ ' : '  '}
            {opt}
          </Text>
        ))}
        <Text> </Text>
        <Text dimColor>↑↓ move · Enter select · Esc close</Text>
      </Box>
    );
  }

  if (phase === 'registering') {
    return (
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Text bold color={accent}>
          Connecting…
        </Text>
        <Text dimColor>Registering your free account.</Text>
      </Box>
    );
  }

  if (phase === 'downloading') {
    return (
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Text bold color={accent}>
          Downloading handoff-serve…
        </Text>
        <Text dimColor>Fetching the latest provider binary from GitHub.</Text>
      </Box>
    );
  }

  if (phase === 'installing') {
    return (
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Text bold color={accent}>
          Installing background service…
        </Text>
        <Text dimColor>Registering with launchd — will auto-start on login.</Text>
      </Box>
    );
  }

  if (phase === 'confirmed') {
    return (
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Text bold color={theme.note}>
          ✓ You&apos;re in!
        </Text>
        <Text> </Text>
        <Text>Balance: 50,000 free tokens</Text>
        <Text dimColor>Token saved. Peer network is now active.</Text>
        <Text dimColor>Inference routes to a peer GPU when local Ollama is unavailable.</Text>
        <Text> </Text>
        <Text dimColor>Enter or Esc to continue</Text>
      </Box>
    );
  }

  if (phase === 'enter_token') {
    return (
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Text bold color={accent}>
          Enter your token
        </Text>
        <Text> </Text>
        <Text dimColor>Paste the token from your other device.</Text>
        <Box borderStyle="round" borderColor={theme.borderActive} paddingX={1}>
          <Text>{tokenInput.replace(/./g, '•') || ' '}</Text>
          <Text color={accent}>▏</Text>
        </Box>
        {tokenError ? <Text color={theme.error}>{tokenError}</Text> : null}
        <Text> </Text>
        <Text dimColor>Enter to save · Esc back</Text>
      </Box>
    );
  }

  // ── Menu ─────────────────────────────────────────────────────────────────
  const bal = peerCredits !== null ? peerCredits.toLocaleString() : '…';
  const statusDot = config.peerNetworkEnabled ? '●' : '○';
  const statusColor = config.peerNetworkEnabled ? theme.note : theme.border;

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Box gap={1}>
        <Text bold>Peer GPU network</Text>
        <Text color={statusColor}>
          {statusDot} {config.peerNetworkEnabled ? 'on' : 'off'}
        </Text>
      </Box>
      <Text dimColor>Balance {bal} tokens</Text>
      <Text> </Text>
      {menuOptions.map((opt, i) => (
        <Text key={opt} color={i === menuIdx ? accent : undefined}>
          {i === menuIdx ? '❯ ' : '  '}
          {opt}
        </Text>
      ))}
      {installError ? (
        <Box flexDirection="column">
          <Text> </Text>
          <Text color={theme.error}>⚠ {installError}</Text>
        </Box>
      ) : null}
      <Text> </Text>
      <Text dimColor>↑↓ move · Enter select · Esc close</Text>
    </Box>
  );
}
