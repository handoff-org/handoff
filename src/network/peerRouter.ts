import { execFileSync, spawn } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import type { Config } from '../../config/schema.js';

// Module-level flag so we only attempt to start the daemon once per session.
let daemonEnsured = false;

/** Ping local Ollama with a short timeout. Returns true if reachable. */
async function pingOllama(baseUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

/** Ping the relay /health endpoint. Returns true if reachable. */
async function pingRelay(relayUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${relayUrl}/health`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

/** Wait up to maxMs for the relay to become reachable. */
async function waitForRelay(relayUrl: string, maxMs: number): Promise<void> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    if (await pingRelay(relayUrl)) return;
    await new Promise((r) => setTimeout(r, 300));
  }
}

function isLocalhostUrl(url: string): boolean {
  return url.includes('localhost') || url.includes('127.0.0.1');
}

function toWsUrl(httpUrl: string): string {
  return httpUrl.replace(/^http:\/\//, 'ws://').replace(/^https:\/\//, 'wss://');
}

/** Find the handoff-serve binary — PATH, auto-download location, or dev build. */
function findServeBin(): string | null {
  // 1. Installed in PATH
  try {
    const p = execFileSync('which', ['handoff-serve'], { encoding: 'utf8' }).trim();
    if (p) return p;
  } catch {
    /* not in PATH */
  }

  // 2. Standard install location (placed here by the handoff installer)
  const home = process.env['HOME'] ?? '';
  const handoffBin = join(home, '.handoff', 'bin', 'handoff-serve');
  if (existsSync(handoffBin)) return handoffBin;

  // 3. Legacy auto-download location
  const local = join(home, '.local', 'bin', 'handoff-serve');
  if (existsSync(local)) return local;

  // 4. Common dev build locations
  for (const candidate of [
    join(home, 'Desktop', 'handoff-relay', 'serve'),
    join(process.cwd(), '..', 'handoff-relay', 'serve'),
  ]) {
    if (existsSync(candidate)) return candidate;
  }

  return null;
}

/**
 * If peer network is enabled and the relay URL is localhost, auto-start the
 * provider daemon (with --embedded-relay) so the user doesn't need a separate
 * terminal. No-op if the relay is already up, binary not found, or relay is remote.
 */
async function ensurePeerDaemon(config: Config): Promise<void> {
  if (daemonEnsured) return;
  if (!config.peerNetworkEnabled || !config.peerToken) return;
  if (!isLocalhostUrl(config.peerRelayUrl)) return;

  daemonEnsured = true; // set before await to prevent concurrent calls

  if (await pingRelay(config.peerRelayUrl)) return; // already running

  const bin = findServeBin();
  if (!bin) return; // no binary available — user will see relay-unreachable error

  spawn(
    bin,
    ['--token', config.peerToken, '--relay', toWsUrl(config.peerRelayUrl), '--embedded-relay'],
    { detached: true, stdio: 'ignore' },
  ).unref();

  await waitForRelay(config.peerRelayUrl, 6000);
}

/**
 * Resolve the Ollama base URL to use for this turn.
 * - Peer network disabled → always local.
 * - peerFallbackOnly (default) → local if reachable, relay otherwise.
 * - peerFallbackOnly false → relay directly.
 *
 * When the relay URL is localhost, auto-starts the serve daemon if needed.
 */
export async function resolveOllamaUrl(config: Config): Promise<string> {
  if (!config.peerNetworkEnabled || !config.peerToken) {
    return config.ollamaBaseUrl;
  }
  await ensurePeerDaemon(config);
  if (config.peerFallbackOnly) {
    const localOk = await pingOllama(config.ollamaBaseUrl);
    if (localOk) return config.ollamaBaseUrl;
  }
  return `${config.peerRelayUrl}/ollama`;
}
