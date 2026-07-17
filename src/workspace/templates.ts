export type PaperTemplate = 'blank' | 'acl' | 'neurips';

export const TEMPLATE_LABELS: Record<PaperTemplate, string> = {
  blank: 'Blank LaTeX',
  acl: 'ACL 2026',
  neurips: 'NeurIPS 2026',
};

/**
 * Starter bibliography, written to paper/refs.bib alongside main.tex so it sits
 * in the same directory as the paper — and, when the project is linked, syncs to
 * Overleaf with it. The filename (refs) matches the blank template's \bibliography{refs}.
 */
export function starterBib(title: string): string {
  return `% Bibliography for ${title}\n% Add BibTeX entries here; cite them with \\cite{key}.\n`;
}

/**
 * A minimal, compilable LaTeX skeleton for the "blank" template — the one option
 * with no on-disk template folder. ACL and NeurIPS render straight from the files
 * in their template folders (templates/<venue>/main.tex + styles), so they carry
 * no code-generated string here.
 */
export function blankTemplate(title: string): string {
  return [
    '\\documentclass{article}',
    '',
    '\\usepackage[utf8]{inputenc}',
    '\\usepackage[T1]{fontenc}',
    '\\usepackage{amsmath,amssymb}',
    '\\usepackage{graphicx}',
    '\\usepackage{hyperref}',
    '\\usepackage{natbib}',
    '',
    `\\title{${title}}`,
    '\\author{Your Name}',
    '\\date{\\today}',
    '',
    '\\begin{document}',
    '\\maketitle',
    '',
    '\\begin{abstract}',
    'Abstract.',
    '\\end{abstract}',
    '',
    '\\section{Introduction}',
    '',
    '\\section{Related Work}',
    '',
    '\\section{Method}',
    '',
    '\\section{Experiments}',
    '',
    '\\section{Results}',
    '',
    '\\section{Conclusion}',
    '',
    '\\bibliographystyle{plainnat}',
    '\\bibliography{refs}',
    '',
    '\\end{document}',
  ].join('\n');
}
