import { basename } from 'path';

// LaTeX safety helpers, kept in a dependency-free module so both the system
// prompt (starterTex) and the template store (title substitution) can reuse
// them without importing each other.

/** Escape LaTeX-special characters in free text (e.g. a user-supplied title). */
export function escapeLatex(s: string): string {
  return s
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/([&%$#_{}])/g, '\\$1')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}');
}

/**
 * Normalize a bibliography base name into a safe filename stem: no path, no
 * extension, only [A-Za-z0-9._-]. Falls back to "refs" when nothing usable
 * remains — never a path, command, or LaTeX.
 */
export function sanitizeBibBase(raw: string): string {
  const stem = basename(String(raw ?? '')).replace(/\.bib$/i, '');
  const cleaned = stem.replace(/[^A-Za-z0-9._-]/g, '').replace(/^\.+/, '');
  return cleaned || 'refs';
}

/**
 * A complete, compilable LaTeX skeleton for a brand-new paper. `title` is escaped
 * and `bibBase` sanitized before interpolation so a hostile or messy value can't
 * break compilation. Loads natbib (+ booktabs, xurl, hidelinks hyperref) and both
 * bibliography lines so citations work on Overleaf out of the box.
 */
export function starterTex(title: string, bibBase: string): string {
  const safeTitle = escapeLatex(String(title ?? '').trim() || 'Untitled');
  const safeBib = sanitizeBibBase(bibBase);
  const lines = [
    '\\documentclass{article}',
    '',
    '\\usepackage[utf8]{inputenc}',
    '\\usepackage[T1]{fontenc}',
    '\\usepackage{amsmath,amssymb}',
    '\\usepackage{graphicx}',
    '\\usepackage{booktabs}',
    '\\usepackage{xurl}',
    '\\usepackage[hidelinks]{hyperref}',
    '\\usepackage{natbib}',
    '',
    `\\title{${safeTitle}}`,
    '\\author{Your Name}',
    '\\date{\\today}',
    '',
    '\\begin{document}',
    '\\maketitle',
    '',
    '\\section{Introduction}',
    '',
    '% Write the paper here. Cite with \\cite{key}, where key matches an entry in',
    `% ${safeBib}.bib. Keep BOTH bibliography lines below before \\end{document}.`,
    '',
    '\\bibliographystyle{plainnat}',
    `\\bibliography{${safeBib}}`,
    '',
    '\\end{document}',
  ];
  // Exactly one trailing newline.
  return lines.join('\n') + '\n';
}
