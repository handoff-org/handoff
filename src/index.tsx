#!/usr/bin/env node
import React, { useState, useMemo } from 'react';
import { render } from 'ink';
import { loadConfig, type Config } from '../config/schema.js';
import { ToolRegistry } from './tools/registry.js';
import { registerBuiltins } from './tools/builtin.js';
import { registerResearchTools } from './research/tools.js';
import { registerSkillTools } from './skills/tools.js';
import { registerWorkspaceTools } from './workspace/tools.js';
import { registerOverleafTools } from './workspace/overleaf.js';
import { registerRunnerTools } from './workspace/runner.js';
import { seedTemplates } from './workspace/templateStore.js';
import { inkControl } from '../ui/inkControl.js';
import { App } from '../ui/app.js';
import { ErrorBoundary } from '../ui/ErrorBoundary.js';
import { SetupWizard } from '../ui/SetupWizard.js';
import { loadLastSession, summarizeSession } from '../config/sessions.js';
import { appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { redactSecrets } from './util/redact.js';
import { ALT_SCREEN_ON, ALT_SCREEN_OFF } from '../ui/terminalControl.js';

const RESUME = process.argv.includes('--resume') || process.argv.includes('-r');

function Root({
  initialConfig,
  autoResume,
}: {
  initialConfig: Config;
  autoResume: boolean;
}) {
  // When resuming we already know the config, so skip the setup wizard.
  const [config, setConfig] = useState<Config | null>(autoResume ? initialConfig : null);

  // Build the tool registry exactly once for the app's lifetime — registration
  // is a side-effecting loop, so doing it inline in render would rebuild and
  // re-register every tool on each render (e.g. every SetupWizard keystroke).
  const registry = useMemo(() => {
    const r = new ToolRegistry();
    registerBuiltins(r);
    registerResearchTools(r);
    registerSkillTools(r);
    registerWorkspaceTools(r);
    registerOverleafTools(r);
    registerRunnerTools(r);
    return r;
  }, []);

  if (!config) {
    return <SetupWizard initialConfig={initialConfig} onComplete={setConfig} />;
  }

  return <App initialConfig={config} registry={registry} autoResume={autoResume} />;
}

const startTime = Date.now();

// handoff is an interactive TUI — it needs a real terminal for keyboard input.
// Fail with a clear one-liner instead of rendering and then throwing Ink's
// "Raw mode is not supported" deep in the tree (piped stdin, some CI shells).
if (!process.stdin.isTTY) {
  process.stderr.write(
    'handoff needs an interactive terminal (TTY). Run `handoff` directly in your terminal.\n',
  );
  process.exit(1);
}

const config = await loadConfig();
// Seed built-in paper templates into ~/.handoff/templates on first run so the
// agent has something to copy (and users can add their own alongside them).
seedTemplates();
const lastSession = await loadLastSession();
const doResume = RESUME && !!lastSession;

// Enter the alternate screen buffer so the TUI renders on a clean slate and
// the original terminal content is restored exactly when handoff exits —
// same behaviour as vim, less, man. This module is the SOLE owner of the alt
// screen (ui/app.tsx only manages input/scroll modes) so it can be popped
// exactly once, after Ink unmounts, letting the exit recap print on the normal
// screen. See ui/terminalControl.ts. No-op on terminals that don't support it.
if (process.stdout.isTTY) {
  process.stdout.write(ALT_SCREEN_ON);
  process.on('exit', () => process.stdout.write(ALT_SCREEN_OFF));
}

const instance = render(
  <ErrorBoundary>
    <Root initialConfig={config} autoResume={doResume} />
  </ErrorBoundary>,
);
// Let the App reset Ink's render state after an external editor (/compose-skill).
inkControl.clear = instance.clear;

// Append a redacted line to a local, best-effort log. Never touches stdout/stderr
// while Ink is mounted (that would corrupt the TUI), and never throws.
function logFatal(label: string, err: unknown): void {
  try {
    const dir = join(homedir(), '.handoff', 'logs');
    mkdirSync(dir, { recursive: true });
    const detail = err instanceof Error ? err.stack ?? err.message : String(err);
    appendFileSync(
      join(dir, 'handoff.log'),
      `${new Date().toISOString()} ${label}: ${redactSecrets(detail)}\n`,
    );
  } catch {
    /* logging is best-effort */
  }
}

// A stray unhandled rejection must not crash the process (which, mid-render,
// would leave the terminal in raw mode). Log it and keep the app alive.
process.on('unhandledRejection', (reason) => {
  logFatal('unhandledRejection', reason);
});

// An uncaught exception may mean corrupt state — restore the terminal cleanly
// (Ink unmount pops the alt screen and disables raw mode), report one redacted
// line, and exit rather than leaving a broken terminal.
process.on('uncaughtException', (err) => {
  logFatal('uncaughtException', err);
  try {
    instance.unmount();
  } catch {
    /* ignore */
  }
  process.stderr.write(
    `\nhandoff stopped after an unexpected error: ${redactSecrets(
      err instanceof Error ? err.message : String(err),
    )}\nDetails: ${join(homedir(), '.handoff', 'logs', 'handoff.log')}\n`,
  );
  process.exit(1);
});

// Catch SIGINT (Ctrl+C) and unmount Ink cleanly instead of letting the
// default handler call process.exit() while the top-level await is still
// pending — that would emit the "unsettled top-level await" Node.js warning.
const onSigint = () => instance.unmount();
process.once('SIGINT', onSigint);

await instance.waitUntilExit();
process.off('SIGINT', onSigint);

// On quit: clear the conversation, then show a recap + how to resume.
const session = await loadLastSession();
const savedThisRun = session && new Date(session.savedAt).getTime() >= startTime;
process.stdout.write('\x1b[2J\x1b[3J\x1b[H');

if (savedThisRun && session) {
  const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
  const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
  const accent = (s: string) => `\x1b[38;2;86;175;164m${s}\x1b[0m`;

  let out = '\n  ' + bold('handoff') + dim('  ·  session ended') + '\n\n';
  for (const { label, value } of summarizeSession(session)) {
    out += '  ' + dim(label.padEnd(9)) + value + '\n';
  }
  out += '\n  ' + dim('resume this conversation →  ') + accent('handoff --resume') + '\n\n';
  process.stdout.write(out);
}
