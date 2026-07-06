#!/usr/bin/env node
// Launcher: runs the TypeScript source directly via tsx so the `handoff`
// command always reflects the latest code — no separate build step needed.
import { spawn, execFile } from 'child_process';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';
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

async function ensureOllamaServe() {
  if (await isOllamaRunning()) return;
  if (!(await ollamaInstalled())) return;

  const srv = spawn('ollama', ['serve'], { detached: true, stdio: 'ignore' });
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
