/**
 * Lightweight documentation linter for the GitHub Pages site under docs/.
 * Dependency-free (Node stdlib only); run with `npm run docs:check`.
 *
 * Checks, per Markdown page:
 *   - exactly one H1 (ignoring `#` inside fenced code blocks)
 *   - internal links point to files that exist (…/foo.md, assets/x.png)
 *   - link anchors (#slug) resolve to a heading on the target page
 *   - no empty links `]( )`
 *   - no placeholders (TODO / FIXME / WIP / lorem / coming soon)
 *   - no absolute local paths (/Users/…, /home/…)
 *   - no obvious secrets (private key blocks, AWS keys)
 * Exits non-zero if any error is found.
 */
import { readdirSync, readFileSync, existsSync } from 'fs';
import { join, dirname, resolve } from 'path';

const DOCS = join(process.cwd(), 'docs');
const errors: string[] = [];
const warnings: string[] = [];

/** Strip fenced code blocks so their contents don't trip the text checks. */
function stripFences(md: string): string {
  return md.replace(/^```[\s\S]*?^```/gm, '');
}

/**
 * Strip inline code spans (`…`) for the same reason we strip fenced blocks:
 * their contents are literal/technical tokens, not prose. Without this, a doc
 * legitimately describing a `%TODO:` LaTeX marker would trip the placeholder
 * check. Prose placeholders (unbackticked "TODO: finish this") are still caught.
 */
function stripInlineCode(md: string): string {
  return md.replace(/`[^`]*`/g, '');
}

/** kramdown/GitHub-style heading slug. */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/`/g, '')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

/** Collect heading slugs (h1–h6) of a page, outside code fences. */
function headingSlugs(md: string): Set<string> {
  const slugs = new Set<string>();
  for (const line of stripFences(md).split('\n')) {
    const m = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (m) slugs.add(slugify(m[1]!));
  }
  return slugs;
}

const mdFiles = readdirSync(DOCS).filter((f) => f.endsWith('.md'));
const slugCache = new Map<string, Set<string>>();
const readOf = (p: string) => readFileSync(p, 'utf-8');
const slugsOf = (p: string) => {
  if (!slugCache.has(p)) slugCache.set(p, headingSlugs(readOf(p)));
  return slugCache.get(p)!;
};

for (const file of mdFiles) {
  const path = join(DOCS, file);
  const raw = readOf(path);
  const body = stripFences(raw);
  const where = `docs/${file}`;

  // One H1 — count both Markdown `# …` and HTML `<h1>…` forms.
  const mdH1s = body.split('\n').filter((l) => /^#\s+\S/.test(l)).length;
  const htmlH1s = (body.match(/<h1[\s>]/gi) ?? []).length;
  const h1s = mdH1s + htmlH1s;
  if (h1s !== 1) errors.push(`${where}: expected exactly one H1, found ${h1s}`);

  // Placeholders — check prose only (inline code spans hold literal tokens
  // like `%TODO:` that describe features, not unfinished documentation).
  const prose = stripInlineCode(body);
  const ph = prose.match(/\b(TODO|FIXME|WIP|lorem)\b|coming soon/i);
  if (ph) errors.push(`${where}: placeholder text found ("${ph[0]}")`);

  // Absolute local paths.
  const abs = raw.match(/\/(?:Users|home)\/[a-z0-9_.-]+/i);
  if (abs) errors.push(`${where}: absolute local path found ("${abs[0]}")`);

  // Obvious secrets.
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----|AKIA[0-9A-Z]{16}/.test(raw)) {
    errors.push(`${where}: possible secret committed`);
  }

  // Links: [text](target)
  for (const m of raw.matchAll(/\]\(([^)]*)\)/g)) {
    const target = m[1]!.trim();
    if (target === '') {
      errors.push(`${where}: empty link target`);
      continue;
    }
    // Skip external, mailto, and Jekyll/liquid links.
    if (/^(https?:|mailto:|\{\{)/.test(target)) continue;

    const [rel, anchor] = target.split('#') as [string, string?];
    if (rel !== '') {
      // Resolve the file part (relative links only; ignore absolute site paths).
      if (rel.startsWith('/')) continue;
      const resolved = resolve(dirname(path), rel);
      if (!existsSync(resolved)) {
        errors.push(`${where}: link to missing file "${rel}"`);
        continue;
      }
      // Anchor into another Markdown page.
      if (anchor && rel.endsWith('.md')) {
        if (!slugsOf(resolved).has(anchor)) {
          errors.push(`${where}: link anchor "#${anchor}" not found in ${rel}`);
        }
      }
    } else if (anchor) {
      // Same-page anchor.
      if (!slugsOf(path).has(anchor)) {
        warnings.push(`${where}: same-page anchor "#${anchor}" not found`);
      }
    }
  }

  // Liquid asset references: {{ '/assets/x.png' | relative_url }}
  for (const m of raw.matchAll(/\{\{\s*['"]\/([^'"]+)['"]\s*\|\s*relative_url\s*\}\}/g)) {
    const assetPath = join(DOCS, m[1]!);
    if (!existsSync(assetPath)) errors.push(`${where}: missing asset "${m[1]}"`);
  }
}

for (const w of warnings) console.warn(`⚠ ${w}`);
for (const e of errors) console.error(`✗ ${e}`);

if (errors.length) {
  console.error(`\ndocs:check — ${errors.length} error(s), ${warnings.length} warning(s).`);
  process.exit(1);
}
console.log(`docs:check — ${mdFiles.length} pages OK (${warnings.length} warning(s)).`);
