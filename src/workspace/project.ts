import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'fs';
import { join, isAbsolute, resolve } from 'path';
import { homedir } from 'os';

/** Root for all research projects. */
export const PROJECTS_DIR = join(homedir(), '.handoff', 'projects');

/** Subdirectories scaffolded inside every research project. */
export const WORKSPACE_SUBDIRS = ['literature', 'experiments', 'runs', 'results', 'paper'] as const;

/** How the paper pillar writes: a paid Overleaf git bridge, or local LaTeX. */
export type PaperMode = 'overleaf' | 'local';

export interface ProjectMeta {
  slug: string;
  title: string;
  description: string;
  field?: string;
  /** Chosen when the user first enters writing mode; unset until then. */
  paperMode?: PaperMode;
  createdAt: string;
}

const META_FILE = 'project.json';
const ACTIVE_FILE = join(PROJECTS_DIR, '.active');

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function projectDir(slug: string): string {
  return join(PROJECTS_DIR, slug);
}

/** Absolute paths for a project's root, every subdir, and its metadata file. */
export function projectPaths(
  slug: string,
): Record<(typeof WORKSPACE_SUBDIRS)[number] | 'root' | 'meta', string> {
  const root = projectDir(slug);
  const out = { root, meta: join(root, META_FILE) } as Record<string, string>;
  for (const sub of WORKSPACE_SUBDIRS) out[sub] = join(root, sub);
  return out as ReturnType<typeof projectPaths>;
}

function seedReadme(meta: ProjectMeta): string {
  return (
    `# ${meta.title}\n\n` +
    (meta.description ? `${meta.description}\n\n` : '') +
    (meta.field ? `**Field:** ${meta.field}\n\n` : '') +
    `A handoff research project. Layout:\n\n` +
    '```\n' +
    'literature/   notes, cached papers, reading\n' +
    'experiments/  scripts + environment\n' +
    'runs/         logged experiment runs (params, metrics, outputs)\n' +
    'results/      tables + figures\n' +
    'paper/        the draft (main.tex) + its bibliography (refs.bib)\n' +
    '```\n'
  );
}

export interface CreateProjectInput {
  title: string;
  description?: string;
  field?: string;
  paperMode?: PaperMode;
}

/** Scaffold a new project on disk and make it active. Throws if it exists. */
export function createProject(input: CreateProjectInput): ProjectMeta {
  const slug = slugify(input.title);
  if (!slug) throw new Error('Project name must contain letters or numbers.');
  const root = projectDir(slug);
  if (existsSync(root)) throw new Error(`A project named "${slug}" already exists.`);

  for (const sub of WORKSPACE_SUBDIRS) {
    mkdirSync(join(root, sub), { recursive: true });
  }

  const meta: ProjectMeta = {
    slug,
    title: input.title.trim(),
    description: input.description?.trim() ?? '',
    ...(input.field?.trim() ? { field: input.field.trim() } : {}),
    ...(input.paperMode ? { paperMode: input.paperMode } : {}),
    createdAt: new Date().toISOString(),
  };

  const paths = projectPaths(slug);
  writeFileSync(paths.meta, JSON.stringify(meta, null, 2), 'utf-8');
  writeFileSync(join(root, 'README.md'), seedReadme(meta), 'utf-8');
  writeFileSync(
    join(root, 'NOTEBOOK.md'),
    `# Lab Notebook — ${meta.title}\n\n` +
      `Auto-kept research journal. handoff appends here whenever an experiment\n` +
      `runs, papers are found, sections are drafted, or insights are recorded.\n\n` +
      `---\n`,
    'utf-8',
  );

  setActiveProject(slug);
  return meta;
}

/** Read one project's metadata, or null if it doesn't exist / is unreadable. */
export function loadProject(slug: string): ProjectMeta | null {
  try {
    const raw = readFileSync(projectPaths(slug).meta, 'utf-8');
    return JSON.parse(raw) as ProjectMeta;
  } catch {
    return null;
  }
}

/** All projects, newest first. */
export function listProjects(): ProjectMeta[] {
  let entries: string[];
  try {
    entries = readdirSync(PROJECTS_DIR);
  } catch {
    return [];
  }
  const projects: ProjectMeta[] = [];
  for (const name of entries) {
    const meta = loadProject(name);
    if (meta) projects.push(meta);
  }
  return projects.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Persist a metadata update (e.g. paperMode once writing mode is entered). */
export function updateProject(slug: string, patch: Partial<ProjectMeta>): ProjectMeta {
  const current = loadProject(slug);
  if (!current) throw new Error(`No project named "${slug}".`);
  const next: ProjectMeta = { ...current, ...patch, slug: current.slug };
  writeFileSync(projectPaths(slug).meta, JSON.stringify(next, null, 2), 'utf-8');
  return next;
}

export function setActiveProject(slug: string): void {
  mkdirSync(PROJECTS_DIR, { recursive: true });
  writeFileSync(ACTIVE_FILE, slug, 'utf-8');
}

/**
 * Permanently delete a project and all of its files. If it was the active
 * project, the active pointer is cleared. Throws if the project doesn't exist.
 */
export function deleteProject(slug: string): void {
  const root = projectDir(slug);
  if (!existsSync(root)) throw new Error(`No project named "${slug}".`);
  rmSync(root, { recursive: true, force: true });
  try {
    if (readFileSync(ACTIVE_FILE, 'utf-8').trim() === slug) {
      rmSync(ACTIVE_FILE, { force: true });
    }
  } catch {
    /* no active pointer to clear */
  }
}

/** The active project's metadata, or null if none is set or it's gone. */
export function getActiveProject(): ProjectMeta | null {
  try {
    const slug = readFileSync(ACTIVE_FILE, 'utf-8').trim();
    return slug ? loadProject(slug) : null;
  } catch {
    return null;
  }
}

/**
 * Resolve a tool-supplied file path. Absolute paths are used as-is; relative
 * paths resolve against the active project's root, so a write to
 * "paper/refs.bib" lands inside the project the user is working on rather
 * than wherever handoff happened to be launched. With no active project it
 * falls back to the current working directory.
 */
export function resolveWorkspacePath(p: string): string {
  if (!p) return resolve('.');
  if (isAbsolute(p)) return p;
  const meta = getActiveProject();
  return meta ? join(projectDir(meta.slug), p) : resolve(p);
}
