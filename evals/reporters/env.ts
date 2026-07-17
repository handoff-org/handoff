import { execSync } from 'node:child_process';
import { platform, arch, cpus, totalmem, hostname } from 'node:os';
import { SYSTEM_PROMPT_VERSION } from '../../src/agent/systemPrompt.js';
import { RUNNER_VERSION } from '../runners/engine.js';

export interface RunMeta {
  runId: string;
  timestamp: string;
  commit: string;
  model: string;
  systemPromptVersion: number;
  runnerVersion: number;
  suite: string;
  filters: Record<string, unknown>;
}

export interface EnvironmentInfo {
  node: string;
  platform: string;
  arch: string;
  cpus: number;
  memGb: number;
  host: string;
}

function safe(cmd: string): string {
  try {
    return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return 'unknown';
  }
}

/** Time-ordered run id. Uses Date (this is normal CLI code, not a workflow script). */
export function newRunId(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

export function gitCommit(): string {
  return safe('git rev-parse --short HEAD');
}

export function environmentInfo(): EnvironmentInfo {
  return {
    node: process.version,
    platform: platform(),
    arch: arch(),
    cpus: cpus().length,
    memGb: Math.round((totalmem() / 1e9) * 10) / 10,
    host: hostname(),
  };
}

export function makeRunMeta(
  suite: string,
  model: string,
  filters: Record<string, unknown>,
): RunMeta {
  return {
    runId: newRunId(),
    timestamp: new Date().toISOString(),
    commit: gitCommit(),
    model,
    systemPromptVersion: SYSTEM_PROMPT_VERSION,
    runnerVersion: RUNNER_VERSION,
    suite,
    filters,
  };
}
