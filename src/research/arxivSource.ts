import { gunzipSync } from 'zlib';

/**
 * Read an arXiv paper's LaTeX source (the .tar.gz from arxiv.org/src/<id>) into
 * readable text. This preserves equations and section structure that the flattened
 * PDF text loses. Pure + fixture-testable: the network fetch lives in the tool
 * (src/research/tools.ts); everything here operates on buffers/strings.
 */

const MAX_ARCHIVE_BYTES = 40 * 1024 * 1024; // decompressed cap — zip-bomb guard

export interface SourceFile {
  name: string;
  content: string;
}

// ── tar (USTAR) ─────────────────────────────────────────────────────────────

/**
 * Parse a (decompressed) tar buffer into text files. Minimal USTAR reader:
 * 512-byte header + 512-aligned data blocks. Skips non-regular entries and
 * PAX/GNU long-name extension records (type 'x','g','L','K') — arXiv main files
 * have short names, so we don't need long-name reconstruction. Non-UTF8 (binary)
 * entries are skipped.
 */
export function parseTar(buf: Buffer): SourceFile[] {
  const files: SourceFile[] = [];
  let offset = 0;
  while (offset + 512 <= buf.length) {
    const header = buf.subarray(offset, offset + 512);
    // Two consecutive zero blocks mark the end of the archive.
    if (header.every((b) => b === 0)) break;

    const name = cstr(header.subarray(0, 100));
    const sizeField = cstr(header.subarray(124, 136)).trim();
    const size = parseInt(sizeField, 8) || 0;
    const typeFlag = String.fromCharCode(header[156] ?? 0);
    const prefix = cstr(header.subarray(345, 500));
    const fullName = prefix ? `${prefix}/${name}` : name;

    const dataStart = offset + 512;
    const dataEnd = dataStart + size;
    // Regular file: typeFlag '0' or '\0'. Skip everything else (dirs, links, PAX).
    if ((typeFlag === '0' || typeFlag === '\0') && size > 0 && dataEnd <= buf.length) {
      const data = buf.subarray(dataStart, dataEnd);
      if (looksTextual(data)) files.push({ name: fullName, content: data.toString('utf-8') });
    }
    // Advance past data, padded to the next 512 boundary.
    offset = dataStart + Math.ceil(size / 512) * 512;
  }
  return files;
}

function cstr(b: Buffer): string {
  const zero = b.indexOf(0);
  return b.subarray(0, zero === -1 ? b.length : zero).toString('utf-8');
}

/** Heuristic: treat as text unless it has NUL bytes in the first chunk. */
function looksTextual(b: Buffer): boolean {
  const n = Math.min(b.length, 4096);
  for (let i = 0; i < n; i++) if (b[i] === 0) return false;
  return true;
}

// ── archive → source files ───────────────────────────────────────────────────

/**
 * Extract source files from an arXiv src download. The payload is usually a
 * gzip'd tar, sometimes a gzip'd single .tex, occasionally a bare .tex. Detects
 * gzip by magic bytes (0x1f 0x8b), decompresses, then tar-parses; falls back to
 * treating the (decompressed or raw) bytes as a single main.tex.
 */
export function extractSourceArchive(buf: Buffer): SourceFile[] {
  let data = buf;
  const isGzip = buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b;
  if (isGzip) {
    data = gunzipSync(buf, { maxOutputLength: MAX_ARCHIVE_BYTES });
  }
  // tar magic "ustar" sits at offset 257.
  const isTar = data.length > 262 && data.subarray(257, 262).toString('ascii') === 'ustar';
  if (isTar) {
    const files = parseTar(data);
    if (files.length) return files;
  }
  // Not a tar (or empty) → treat the bytes as a single .tex if they look textual.
  if (looksTextual(data)) return [{ name: 'main.tex', content: data.toString('utf-8') }];
  return [];
}

/**
 * Pick the main .tex file: the one containing `\documentclass`; if several,
 * the largest; if none declare it, the largest .tex overall.
 */
export function pickMainTex(files: SourceFile[]): SourceFile | null {
  const tex = files.filter((f) => f.name.toLowerCase().endsWith('.tex'));
  if (tex.length === 0) return null;
  const withClass = tex.filter((f) => /\\documentclass/.test(f.content));
  const pool = withClass.length ? withClass : tex;
  return pool.reduce((a, b) => (b.content.length > a.content.length ? b : a));
}

// ── tex → readable ────────────────────────────────────────────────────────────

/**
 * Turn LaTeX source into readable text while KEEPING equations and section
 * structure (the reason to read source over the PDF). Drops comments and the
 * preamble, unwraps common markup, but leaves math and \section headings intact.
 */
export function texToReadable(tex: string): string {
  let s = tex;
  // Strip line comments (unescaped %) — keep everything after \%.
  s = s.replace(/(^|[^\\])%.*$/gm, '$1');
  // Drop the preamble: keep from \begin{document} if present.
  const docStart = s.indexOf('\\begin{document}');
  if (docStart !== -1) s = s.slice(docStart + '\\begin{document}'.length);
  const docEnd = s.indexOf('\\end{document}');
  if (docEnd !== -1) s = s.slice(0, docEnd);

  // Section headings → readable markers (keep the structure).
  s = s.replace(/\\(sub)*section\*?\{([^}]*)\}/g, (_m, subs: string, title: string) => {
    const depth = subs ? subs.length / 3 : 0; // "sub" repeated
    return `\n\n${'#'.repeat(depth + 2)} ${title}\n`;
  });
  s = s.replace(/\\(paragraph|subparagraph)\*?\{([^}]*)\}/g, '\n\n**$2** ');

  // Common inline markup → text (keep the argument).
  s = s.replace(/\\(?:textbf|textit|emph|texttt|textsc|mbox|text)\{([^}]*)\}/g, '$1');
  // Citations/refs → compact placeholders (keep the key, it's informative).
  s = s.replace(/\\[a-zA-Z]*cite[a-zA-Z]*\s*(?:\[[^\]]*\])*\{([^}]*)\}/g, '[cite:$1]');
  s = s.replace(/\\(?:ref|autoref|cref|Cref|eqref)\{([^}]*)\}/g, '[ref:$1]');

  // Collapse figure/table environments to just their caption (drop the markup).
  s = s.replace(/\\begin\{(figure|table)\*?\}[\s\S]*?\\end\{\1\*?\}/g, (blk) => {
    const cap = blk.match(/\\caption\{([\s\S]*?)\}/);
    return cap ? `\n[Figure/Table: ${cap[1]!.replace(/\s+/g, ' ').trim()}]\n` : '';
  });

  // Remove remaining \commands that take a brace arg we don't care about, but
  // leave math ($...$, \[...\], equation envs) and plain text untouched.
  s = s.replace(
    /\\(?:label|usepackage|documentclass|input|include|bibliographystyle|bibliography|maketitle|newcommand|renewcommand)\b\*?(\[[^\]]*\])?(\{[^}]*\})?/g,
    '',
  );

  // Whitespace cleanup.
  s = s
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return s;
}

/** End-to-end: archive bytes → readable main-file text (or null if none). */
export function readableFromArchive(buf: Buffer): { name: string; text: string } | null {
  const files = extractSourceArchive(buf);
  const main = pickMainTex(files);
  if (!main) return null;
  return { name: main.name, text: texToReadable(main.content) };
}
