#!/usr/bin/env node
// Launcher: runs the TypeScript source directly via tsx so the `handoff`
// command always reflects the latest code — no separate build step needed.
import { spawn, execFile } from 'child_process';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';
import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { createRequire } from 'module';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const entry = join(root, 'src', 'index.tsx');

// Locate the tsx runtime. A nested install (npm link or `npm i -g`) keeps it
// under the package's own node_modules; otherwise resolve it through Node's
// module resolution so a hoisted or dev layout also works.
function resolveTsx() {
  const localBin = join(root, 'node_modules', '.bin', 'tsx');
  if (existsSync(localBin)) return { cmd: localBin, args: [entry] };
  try {
    const require = createRequire(pathToFileURL(join(root, 'package.json')));
    // tsx ships its CLI as `tsx/cli`; run it through the current node binary.
    const cli = require.resolve('tsx/cli');
    return { cmd: process.execPath, args: [cli, entry] };
  } catch {
    return null;
  }
}

async function isOllamaRunning() {
  try {
    const res = await fetch('http://localhost:11434/api/tags');
    return res.ok;
  } catch {
    return false;
  }
}

function ollamaInstalled() {
  return new Promise((resolve) => {
    execFile('ollama', ['--version'], (err) => resolve(!err));
  });
}

// Read the two Ollama server-perf fields from the stored config (~/.handoff/
// config.json) so the user's /settings choices are authoritative when WE start
// the server. Best-effort: an absent or unreadable config yields no overrides.
function storedOllamaPerf() {
  try {
    const raw = readFileSync(join(homedir(), '.handoff', 'config.json'), 'utf8');
    const cfg = JSON.parse(raw);
    return { flash: cfg.ollamaFlashAttention, kv: cfg.ollamaKvCacheType };
  } catch {
    return {};
  }
}

async function ensureOllamaServe() {
  if (await isOllamaRunning()) return;
  if (!(await ollamaInstalled())) return;

  // Apply handoff's server-perf settings for a server WE auto-start. Precedence:
  // the stored /settings choice wins (so it overrides a stale shell export),
  // else an inherited OLLAMA_* env, else the tuned default. This runs before the
  // UI, so without it a fresh shell — or an installer's shell export — would
  // shadow OllamaPrepare's config-aware startOllamaServe and silently ignore the
  // user's pick. Mirrors ollamaServeEnv() in src/agent/ollama.ts. num_parallel
  // has no /settings knob, so keep it at 1 unless the user exported their own.
  const { flash, kv } = storedOllamaPerf();
  const env = { ...process.env };
  env.OLLAMA_FLASH_ATTENTION =
    flash === false ? '0' : flash === true ? '1' : (env.OLLAMA_FLASH_ATTENTION ?? '1');
  env.OLLAMA_KV_CACHE_TYPE = kv ?? env.OLLAMA_KV_CACHE_TYPE ?? 'q8_0';
  if (env.OLLAMA_NUM_PARALLEL == null) env.OLLAMA_NUM_PARALLEL = '1';

  const srv = spawn('ollama', ['serve'], { detached: true, stdio: 'ignore', env });
  srv.unref();

  // Wait up to 5 s for the API to become ready.
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 250));
    if (await isOllamaRunning()) return;
  }
}

const tsx = resolveTsx();
if (!tsx) {
  console.error(
    'handoff could not find its tsx runtime. Try reinstalling: npm install -g ownhandoff',
  );
  process.exit(1);
}

await ensureOllamaServe();

const child = spawn(tsx.cmd, tsx.args, { stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));
child.on('error', (err) => {
  console.error('Failed to launch handoff:', err.message);
  process.exit(1);
});
