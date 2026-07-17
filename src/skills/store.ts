import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import type { Dirent } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';

/** User-authored skills (editable, take precedence over built-ins). */
export const SKILLS_DIR = join(homedir(), '.handoff', 'skills');

/** Skills shipped with handoff, in the repo's top-level skills/ directory. */
export const BUILTIN_SKILLS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'skills',
);

export interface Skill {
  name: string;
  description: string;
  body: string;
}

/** Starter template shown in the editor — beginner-friendly, with guidance. */
export const SKILL_TEMPLATE = `---
name: my-skill
description: One line — what this skill does and when the agent should use it.
---

# Instructions

<!--
  Everything below the frontmatter is given to the agent when this skill runs.
  Write clear, specific, step-by-step instructions. Delete these comment hints
  when you're done, then save and close the editor.
-->

## When to use this
Describe the situation this skill is for.

## Steps
1. First, ...
2. Then, ...
3. Finally, ...

## Notes
Constraints, examples, or things to avoid.
`;

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function parseFrontmatter(content: string): {
  name?: string;
  description?: string;
  body: string;
} {
  const m = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!m) return { body: content };
  const fm = m[1] ?? '';
  const body = m[2] ?? '';
  const field = (key: string): string | undefined => {
    const r = fm.match(new RegExp(`^${key}\\s*:\\s*(.+)$`, 'm'));
    return r ? r[1]!.trim().replace(/^["']|["']$/g, '') : undefined;
  };
  return { name: field('name'), description: field('description'), body };
}

/** Parse one skill markdown file into a Skill, or null if it has no name/is unreadable. */
function readSkillFile(path: string): Skill | null {
  try {
    const content = readFileSync(path, 'utf-8');
    const { name, description, body } = parseFrontmatter(content);
    if (name) return { name, description: description ?? '', body: body.trim() };
  } catch {
    // skip unreadable files
  }
  return null;
}

/**
 * Load every skill in `dir`. Two layouts are supported side by side:
 *   - a per-skill folder `<dir>/<name>/<name>.md` (the built-in convention; falls
 *     back to the first .md in the folder if it isn't named after the folder), and
 *   - a flat `<dir>/<name>.md` file (used by user-composed skills via saveUserSkill).
 * Dot-entries (e.g. .DS_Store) are ignored.
 */
function readSkillsFrom(dir: string): Skill[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const skills: Skill[] = [];
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    if (e.isFile() && e.name.endsWith('.md')) {
      const s = readSkillFile(join(dir, e.name));
      if (s) skills.push(s);
    } else if (e.isDirectory()) {
      const sub = join(dir, e.name);
      const preferred = join(sub, `${e.name}.md`);
      let file: string | null = existsSync(preferred) ? preferred : null;
      if (!file) {
        try {
          const md = readdirSync(sub).find((f) => f.endsWith('.md'));
          if (md) file = join(sub, md);
        } catch {
          // not a readable skill folder
        }
      }
      if (file) {
        const s = readSkillFile(file);
        if (s) skills.push(s);
      }
    }
  }
  return skills;
}

/** Built-in skills plus the user's own, with user skills overriding by slug. */
export function loadSkills(): Skill[] {
  const bySlug = new Map<string, Skill>();
  for (const s of readSkillsFrom(BUILTIN_SKILLS_DIR)) bySlug.set(slugify(s.name), s);
  for (const s of readSkillsFrom(SKILLS_DIR)) bySlug.set(slugify(s.name), s);
  return Array.from(bySlug.values());
}

export function findSkill(name: string): Skill | undefined {
  const want = slugify(name);
  return loadSkills().find((s) => slugify(s.name) === want);
}

/** Validate and persist a composed skill. Returns the saved name or an error. */
export function saveUserSkill(content: string): { name: string } | { error: string } {
  const { name, description } = parseFrontmatter(content);
  if (!name || slugify(name) === 'my-skill') {
    return { error: 'Set a unique "name:" in the frontmatter (not the placeholder "my-skill").' };
  }
  if (!description) {
    return { error: 'Add a "description:" line so the agent knows when to use the skill.' };
  }
  const id = slugify(name);
  if (!id) return { error: 'The skill name must contain letters or numbers.' };
  try {
    mkdirSync(SKILLS_DIR, { recursive: true });
    writeFileSync(join(SKILLS_DIR, `${id}.md`), content, 'utf-8');
    return { name: id };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
