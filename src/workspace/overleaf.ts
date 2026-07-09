import { spawnSync } from 'child_process';
import { existsSync, readdirSync, readFileSync, mkdirSync } from 'fs';
import { basename, join, resolve, sep } from 'path';
import type { ToolRegistry } from '../tools/registry.js';
import { getActiveProject, projectPaths, updateProject } from './project.js';

/** Strip an embedded token from any URL git might echo back. */
function redact(text: string): string {
  return text.replace(/\/\/[^@\s/]+@/g, '//***@');
}

interface GitResult {
  ok: boolean;
  out: string;
}

/**
 * A committer identity applied inline to every commit. On a fresh machine git
 * has no global user.name/user.email, so `git commit` fails and the agent's
 * paper edits silently never reach Overleaf. Passing the identity per-commit
 * (`-c key=val`) guarantees the commit — and therefore the push — succeeds
 * without touching the user's global git config.
 */
const COMMIT_IDENTITY = ['-c', 'user.name=handoff', '-c', 'user.email=handoff@localhost'];

/** Build a `git commit` argv with a guaranteed committer identity. */
function commitArgs(message: string): string[] {
  return [...COMMIT_IDENTITY, 'commit', '-m', message];
}

/** Run git without a shell (args are passed directly — safe for tokens). */
function git(args: string[], cwd?: string): GitResult {
  // Bounded so a stalled network op or a credential prompt can't hang the UI.
  const opts = { encoding: 'utf8' as const, timeout: 120_000, ...(cwd ? { cwd } : {}) };
  const r = spawnSync('git', args, opts);
  if (r.error) {
    const code = (r.error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return { ok: false, out: 'git is not installed on this machine.' };
    if (code === 'ETIMEDOUT')
      return { ok: false, out: 'git timed out (network stall or credential prompt). Try again.' };
    return { ok: false, out: redact(r.error.message) };
  }
  const out = redact(`${r.stdout ?? ''}${r.stderr ?? ''}`.trim());
  return { ok: r.status === 0, out };
}

/** Pull the project id out of a git URL or a normal Overleaf project link. */
export function parseProjectId(url: string): string | null {
  const m = String(url).match(/overleaf\.com\/(?:project\/)?([A-Za-z0-9]+)/);
  return m ? m[1]!.replace(/\.git$/, '') : null;
}

function requireActivePaper(): { slug: string; title: string; paper: string } {
  const meta = getActiveProject();
  if (!meta) {
    throw new Error('No active project. Create one first with /project new <name>.');
  }
  return { slug: meta.slug, title: meta.title, paper: projectPaths(meta.slug).paper };
}

/**
 * Best guess at the project's root LaTeX document inside paper/: the file that
 * declares \documentclass, else main.tex, else the first .tex file. Returns the
 * absolute path, or null when there's no .tex yet.
 */
export function mainTexFile(paperDir: string): string | null {
  let texFiles: string[];
  try {
    texFiles = readdirSync(paperDir).filter((f) => f.toLowerCase().endsWith('.tex'));
  } catch {
    return null;
  }
  if (texFiles.length === 0) return null;
  for (const f of texFiles) {
    try {
      if (readFileSync(join(paperDir, f), 'utf8').includes('\\documentclass')) {
        return join(paperDir, f);
      }
    } catch {
      /* ignore unreadable */
    }
  }
  const fallback = texFiles.includes('main.tex') ? 'main.tex' : texFiles[0]!;
  return join(paperDir, fallback);
}

/** First .bib file in a directory (absolute path), or null if there is none. */
export function bibFileIn(dir: string): string | null {
  try {
    const bib = readdirSync(dir).find((f) => f.toLowerCase().endsWith('.bib'));
    return bib ? join(dir, bib) : null;
  } catch {
    return null;
  }
}

/**
 * Guard for write_file: in an Overleaf-linked project, block creating a NEW
 * .tex/.md file in paper/ when a main document already exists — the model must
 * edit the single main file instead. Returns a message to show, or null to allow.
 */
export function overleafWriteGuard(targetPath: string, content: string): string | null {
  const meta = getActiveProject();
  if (!meta || meta.paperMode !== 'overleaf') return null;
  const paper = projectPaths(meta.slug).paper;
  if (!existsSync(join(paper, '.git'))) return null;

  const abs = resolve(targetPath);
  const paperAbs = resolve(paper);
  const lower = abs.toLowerCase();
  const inPaper = abs === paperAbs || abs.startsWith(paperAbs + sep);

  // Paper files (.tex/.bib) written outside paper/ never reach Overleaf — the
  // single most common reason "my changes don't show up". Redirect them in.
  if (!inPaper) {
    if (lower.endsWith('.tex') || lower.endsWith('.bib')) {
      const existingBib = bibFileIn(paper);
      const suggested =
        lower.endsWith('.bib') && existingBib ? existingBib : join(paper, basename(abs));
      return (
        `Blocked: ${abs} is outside the Overleaf-synced paper folder, so Overleaf would never ` +
        `see it. Write paper files (.tex/.bib) inside ${paper} instead — use ${suggested} — and ` +
        `make sure the main .tex loads the .bib (\\bibliography or \\addbibresource). Files in ` +
        `${paper} auto-sync to Overleaf.`
      );
    }
    return null; // non-paper files elsewhere are fine
  }

  const fileExists = existsSync(abs);

  // 1. Creating a stray new .tex/.md file when a main document already exists.
  if (!fileExists) {
    if (!lower.endsWith('.tex') && !lower.endsWith('.md')) return null; // assets are fine
    const main = mainTexFile(paper);
    if (!main || resolve(main) === abs) return null; // no main yet, or this IS it
    return (
      `Blocked: this Overleaf paper is a single document. Do not create new files. ` +
      `Edit the main file instead — read ${main}, insert your changes, and write ${main} back.`
    );
  }

  // 2. Overwriting a complete LaTeX document with a fragment (would break the
  //    PDF build). Require the full \documentclass … \end{document} structure.
  if (lower.endsWith('.tex')) {
    let existing = '';
    try {
      existing = readFileSync(abs, 'utf8');
    } catch {
      /* ignore */
    }
    const wasFull = existing.includes('\\documentclass') && existing.includes('\\end{document}');
    const nowFull = content.includes('\\documentclass') && content.includes('\\end{document}');
    if (wasFull && !nowFull) {
      return (
        `Blocked: this would replace the whole LaTeX document with a fragment and break ` +
        `compilation. Read ${abs} first, then write back the COMPLETE file — keep the ` +
        `\\documentclass preamble and the \\begin{document} … \\end{document} wrapper, and ` +
        `insert your new content in the right place inside the document.`
      );
    }
  }

  return null;
}

/** True if the active project's paper/ is already an Overleaf git clone. */
export function isOverleafLinked(): boolean {
  const meta = getActiveProject();
  if (!meta) return false;
  return existsSync(join(projectPaths(meta.slug).paper, '.git'));
}

/** Clone an existing Overleaf project into the active project's paper/ dir. */
export function linkOverleaf(url: string, token: string): string {
  const { slug, title, paper } = requireActivePaper();

  if (existsSync(join(paper, '.git'))) {
    return (
      `"${title}" is already linked to Overleaf. ` +
      `Use overleaf_push to send your changes, or overleaf_sync to pull the latest.`
    );
  }
  const id = parseProjectId(url);
  if (!id) {
    throw new Error(
      "That doesn't look like an Overleaf project link. In Overleaf, open the project " +
        'and copy the URL from your browser (it looks like https://www.overleaf.com/project/...).',
    );
  }
  if (!token.trim()) {
    throw new Error(
      'A Git authentication token is required (Overleaf → Account Settings → Git Integration).',
    );
  }
  if (existsSync(paper) && readdirSync(paper).length > 0) {
    throw new Error('The paper/ folder already has files. Overleaf linking needs it empty.');
  }
  mkdirSync(paper, { recursive: true });

  const authed = `https://git:${token.trim()}@git.overleaf.com/${id}`;
  const res = git(['clone', authed, paper]);
  if (!res.ok) {
    throw new Error(
      `Couldn't connect to your Overleaf project. Double-check the link and the token.\n${res.out}`,
    );
  }
  updateProject(slug, { paperMode: 'overleaf' });
  const files = readdirSync(paper).filter((f) => f !== '.git');
  return (
    `Linked "${title}" to Overleaf and downloaded ${files.length} file(s) into paper/. ` +
    `You can edit them now; say "save to Overleaf" to send changes back.`
  );
}

/** Commit local changes and push them to Overleaf. */
export function pushOverleaf(message?: string): string {
  const { paper } = requireActivePaper();
  if (!existsSync(join(paper, '.git'))) {
    throw new Error("This project isn't linked to Overleaf yet. Use overleaf_link first.");
  }
  git(['add', '-A'], paper);
  const committed = git(commitArgs(message?.trim() || 'Update from handoff'), paper).ok;
  const push = git(['push'], paper);
  if (!push.ok && !/up.to.date/i.test(push.out)) {
    throw new Error(
      `Couldn't send changes to Overleaf. If someone edited it on the web, try overleaf_sync first.\n${push.out}`,
    );
  }
  return committed ? 'Your changes are now saved to Overleaf.' : 'No new changes to send.';
}

/** Pull the latest version from Overleaf (e.g. web edits by collaborators). */
export function syncOverleaf(): string {
  const { paper } = requireActivePaper();
  if (!existsSync(join(paper, '.git'))) {
    throw new Error("This project isn't linked to Overleaf yet. Use overleaf_link first.");
  }
  const pull = git(['pull', '--no-rebase'], paper);
  if (!pull.ok) {
    throw new Error(`Couldn't pull from Overleaf.\n${pull.out}`);
  }
  return /up.to.date/i.test(pull.out)
    ? 'Already up to date with Overleaf.'
    : 'Pulled the latest from Overleaf.';
}

/**
 * If the active project is linked to Overleaf and has local changes, push them.
 * Returns a short status note, or null when there's nothing to do (so callers
 * can run it after every turn without noise). Never throws.
 */
export function autoSyncOverleaf(): string | null {
  const meta = getActiveProject();
  if (!meta || meta.paperMode !== 'overleaf') return null;
  const paper = projectPaths(meta.slug).paper;
  if (!existsSync(join(paper, '.git'))) return null;
  const status = git(['status', '--porcelain'], paper);
  const changed = status.out
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (changed.length === 0) return null; // nothing changed locally
  try {
    pushOverleaf('Auto-sync from handoff');
    const names = changed.map((l) => l.replace(/^\S+\s+/, ''));
    const shown = names.slice(0, 3).join(', ');
    const more = names.length > 3 ? `, +${names.length - 3} more` : '';
    return `↑ synced to Overleaf: ${shown}${more}`;
  } catch (e) {
    return `Overleaf auto-sync failed: ${e instanceof Error ? e.message : String(e)}`;
  }
}

/**
 * If the active project is linked to Overleaf, pull the latest before the agent
 * touches the paper — so edits made on the Overleaf web editor are present and
 * the agent never works on a stale copy. Local edits are committed first so the
 * merge can't fail on "unstaged changes". Returns a short note when something
 * actually came down, else null. Never throws.
 */
export function autoPullOverleaf(): string | null {
  const meta = getActiveProject();
  if (!meta || meta.paperMode !== 'overleaf') return null;
  const paper = projectPaths(meta.slug).paper;
  if (!existsSync(join(paper, '.git'))) return null;
  try {
    const status = git(['status', '--porcelain'], paper);
    if (status.out.trim()) {
      git(['add', '-A'], paper);
      git(commitArgs('Local paper edits'), paper);
    }
    const pull = git(['pull', '--no-rebase'], paper);
    if (!pull.ok) {
      return `Overleaf is ahead and couldn't auto-merge — open it and resolve, then retry.`;
    }
    return /up.to.date/i.test(pull.out) ? null : '↓ pulled the latest from Overleaf';
  } catch {
    return null;
  }
}

/** Report whether the active project is linked and if it has unsaved changes. */
export function overleafStatus(): string {
  const { title, paper } = requireActivePaper();
  if (!existsSync(join(paper, '.git'))) {
    return `"${title}" is not linked to Overleaf yet. Use the overleaf skill or overleaf_link to connect it.`;
  }
  const status = git(['status', '--porcelain'], paper);
  const changes = status.out.split('\n').filter((l) => l.trim()).length;
  return changes === 0
    ? `"${title}" is linked to Overleaf and has no unsaved changes.`
    : `"${title}" is linked to Overleaf with ${changes} unsaved change(s). Say "save to Overleaf" to push them.`;
}

/**
 * Register the Overleaf bridge tools. These wrap git so the model never has to
 * generate git commands; it just supplies the user's link and token.
 */
export function registerOverleafTools(registry: ToolRegistry): void {
  registry.register({
    name: 'overleaf_link',
    description:
      'Connect the active research project to an existing Overleaf project and download ' +
      'its files into paper/. Needs the Overleaf project URL and a Git authentication token.',
    sensitive: true,
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'Overleaf project link, e.g. https://www.overleaf.com/project/<id>',
        },
        token: {
          type: 'string',
          description:
            'Overleaf Git authentication token (from Account Settings → Git Integration)',
        },
      },
      required: ['url', 'token'],
    },
    async execute({ url, token }) {
      return linkOverleaf(String(url ?? ''), String(token ?? ''));
    },
  });

  registry.register({
    name: 'overleaf_push',
    description: "Save the active project's paper changes back to Overleaf (commit + push).",
    sensitive: true,
    parameters: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'Short description of the changes (optional)' },
      },
    },
    async execute({ message }) {
      return pushOverleaf(message ? String(message) : undefined);
    },
  });

  registry.register({
    name: 'overleaf_sync',
    description: 'Pull the latest version of the paper from Overleaf (e.g. edits made on the web).',
    sensitive: true,
    parameters: { type: 'object', properties: {} },
    async execute() {
      return syncOverleaf();
    },
  });

  registry.register({
    name: 'overleaf_status',
    description:
      'Check whether the active project is linked to Overleaf and if it has unsaved changes.',
    parameters: { type: 'object', properties: {} },
    async execute() {
      return overleafStatus();
    },
  });
}
