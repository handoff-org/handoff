import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import { escapeLatex } from '../agent/latex.js';
import { TEMPLATE_LABELS } from './templates.js';
import type { PaperTemplate } from './templates.js';

/** User-managed templates — the only directory start_paper copies from. */
export const TEMPLATES_DIR = join(homedir(), '.handoff', 'templates');

/** Templates shipped with handoff, seeded into TEMPLATES_DIR on first run. */
export const BUILTIN_TEMPLATES_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'templates',
);

/** Token in a template's main.tex replaced with the project title on copy. */
const TITLE_TOKEN = 'TITLE_GOES_HERE';

/** Venues rendered from a code-generated skeleton when no folder is present. */
const CODEGEN_KEYS: PaperTemplate[] = ['blank'];

export interface TemplateChoice {
  key: string;
  label: string;
  /** true → copy the on-disk folder; false → use the code-gen fallback. */
  hasFolder: boolean;
}

/** Subdirectory names in `dir`, ignoring dot-entries (e.g. .github). */
function templateFolders(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

/** Recursively copy a template folder, skipping dot-entries (drops .github CI). */
function copyDir(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const from = join(src, entry.name);
    const to = join(dest, entry.name);
    if (entry.isDirectory()) copyDir(from, to);
    else if (entry.isFile()) copyFileSync(from, to);
  }
}

/**
 * Copy the built-in templates into ~/.handoff/templates on first run — one folder
 * at a time and only when absent, so shipping a new built-in adds it without ever
 * clobbering a template the user edited or authored. Best-effort: a failure here
 * must never block startup.
 */
export function seedTemplates(): void {
  try {
    mkdirSync(TEMPLATES_DIR, { recursive: true });
    for (const name of templateFolders(BUILTIN_TEMPLATES_DIR)) {
      const dest = join(TEMPLATES_DIR, name);
      if (existsSync(dest)) continue;
      copyDir(join(BUILTIN_TEMPLATES_DIR, name), dest);
    }
  } catch {
    /* seeding is best-effort */
  }
}

/** Human label for a template key: known venues get a nice name, else Title Case. */
function labelFor(key: string): string {
  const known = (TEMPLATE_LABELS as Record<string, string>)[key];
  if (known) return known;
  return key.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Templates the agent can offer: every folder in ~/.handoff/templates plus the
 * code-generated fallback (blank) that has no folder. User-added folders
 * appear automatically.
 */
export function listTemplates(): TemplateChoice[] {
  const folders = templateFolders(TEMPLATES_DIR);
  const seen = new Set(folders);
  const choices: TemplateChoice[] = folders.map((key) => ({
    key,
    label: labelFor(key),
    hasFolder: true,
  }));
  for (const key of CODEGEN_KEYS) {
    if (!seen.has(key)) choices.push({ key, label: labelFor(key), hasFolder: false });
  }
  return choices;
}

/** Absolute path to a template folder that contains a main.tex, or null. */
export function resolveTemplateDir(key: string): string | null {
  const dir = join(TEMPLATES_DIR, key);
  return existsSync(join(dir, 'main.tex')) ? dir : null;
}

/**
 * Copy every render material from a template folder into the paper directory
 * (skipping dot-entries), then substitute the project title into main.tex wherever
 * the TITLE_GOES_HERE token appears. If the token is absent, main.tex is left as-is.
 */
export function copyTemplateInto(srcDir: string, destDir: string, title: string): void {
  copyDir(srcDir, destDir);
  const mainPath = join(destDir, 'main.tex');
  try {
    const tex = readFileSync(mainPath, 'utf-8');
    if (tex.includes(TITLE_TOKEN)) {
      writeFileSync(mainPath, tex.split(TITLE_TOKEN).join(escapeLatex(title)), 'utf-8');
    }
  } catch {
    /* no main.tex to retitle — copied as-is */
  }
}
