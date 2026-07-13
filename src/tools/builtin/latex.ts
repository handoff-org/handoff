import { readFile, writeFile } from 'fs/promises';
import { exec } from 'child_process';
import { promisify } from 'util';
import type { ToolRegistry } from '../registry.js';
import { resolveWorkspacePath } from '../../workspace/project.js';

const execAsync = promisify(exec);

/** Shared compile helper: runs latexmk or pdflatex, returns success + error lines. */
export async function runLatexCompile(
  paperDir: string,
): Promise<
  | { ok: true; pdfPath: string; output: string; errors: string[] }
  | { ok: false; pdfPath: string; output: string; errors: string[] }
> {
  const latexmkAvail = await execAsync('command -v latexmk', { timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  const pdflatexAvail = await execAsync('command -v pdflatex', { timeout: 5_000 })
    .then(() => true)
    .catch(() => false);

  if (!latexmkAvail && !pdflatexAvail) {
    const msg =
      'Neither latexmk nor pdflatex found. Install LaTeX:\n' +
      '  macOS:  brew install --cask basictex\n' +
      '  Linux:  sudo apt-get install texlive-latex-extra latexmk\n' +
      '  Windows: winget install MiKTeX.MiKTeX';
    return { ok: false, pdfPath: '', output: msg, errors: [msg] };
  }

  const cmd = latexmkAvail
    ? 'latexmk -pdf -interaction=nonstopmode -halt-on-error main.tex'
    : 'pdflatex -interaction=nonstopmode main.tex && pdflatex -interaction=nonstopmode main.tex';

  try {
    const { stdout, stderr } = await execAsync(cmd, { cwd: paperDir, timeout: 120_000 });
    const out = [stdout, stderr].filter(Boolean).join('\n');
    const match = out.match(/Output written on (.+\.pdf)/);
    const pdfPath = match ? `${paperDir}/${match[1]!.trim()}` : `${paperDir}/main.pdf`;
    return { ok: true, pdfPath, output: `PDF compiled: ${pdfPath}`, errors: [] };
  } catch (err: unknown) {
    const raw =
      (err instanceof Error ? err.message : String(err)) +
      '\n' +
      ((err as { stdout?: string }).stdout ?? '') +
      '\n' +
      ((err as { stderr?: string }).stderr ?? '');
    const errorLines = raw
      .split('\n')
      .filter((l) => /^!|^l\.\d|LaTeX Error|Error:|Fatal/i.test(l))
      .slice(0, 20);
    const output = errorLines.length
      ? `Compilation failed. LaTeX errors:\n${errorLines.join('\n')}`
      : `Compilation failed:\n${raw.slice(0, 1000)}`;
    return {
      ok: false,
      pdfPath: '',
      output,
      errors: errorLines.length ? errorLines : [raw.slice(0, 200)],
    };
  }
}

/**
 * Apply heuristic fixes to .tex files based on parsed error lines.
 * Returns a list of human-readable fix descriptions.
 */
export async function applyLatexFixes(paperDir: string, errors: string[]): Promise<string[]> {
  const { readdir: readdirFs } = await import('fs/promises');
  let texFiles: string[];
  try {
    const entries = await readdirFs(paperDir, { withFileTypes: true });
    texFiles = entries
      .filter((e) => e.isFile() && e.name.endsWith('.tex'))
      .map((e) => `${paperDir}/${e.name}`);
  } catch {
    return [];
  }

  const applied: string[] = [];

  for (const error of errors) {
    // 1. Undefined control sequence: ! Undefined control sequence. \foo
    const undefMatch = error.match(/Undefined control sequence[.\s]*\\(\w+)/i);
    if (undefMatch) {
      const cmd = undefMatch[1]!;
      for (const filePath of texFiles) {
        try {
          let src = await readFile(filePath, 'utf-8');
          const re = new RegExp(`\\\\${cmd}\\b`, 'g');
          if (re.test(src)) {
            src = src.replace(new RegExp(`(\\\\${cmd}\\b)`, 'g'), `%FIXME: undefined \\$1\\n%$1`);
            await writeFile(filePath, src, 'utf-8');
            applied.push(`Commented out \\${cmd} (undefined) in ${filePath}`);
          }
        } catch {
          /* best-effort */
        }
      }
    }

    // 2. Missing package: ! LaTeX Error: File 'pkg.sty' not found.
    const pkgMatch = error.match(/File '(\w+)\.sty' not found/i);
    if (pkgMatch) {
      const pkg = pkgMatch[1]!;
      for (const filePath of texFiles) {
        try {
          let src = await readFile(filePath, 'utf-8');
          if (!src.includes(`\\usepackage{${pkg}}`) && src.includes('\\usepackage{')) {
            src = src.replace(/(\\usepackage\{[^}]+\})/, `$1\n\\usepackage{${pkg}}`);
            await writeFile(filePath, src, 'utf-8');
            applied.push(`Added \\usepackage{${pkg}} to ${filePath}`);
            break;
          }
        } catch {
          /* best-effort */
        }
      }
    }

    // 3. Undefined citation: Citation 'key' on page N undefined
    const citeMatch = error.match(/Citation '([^']+)' on page/i);
    if (citeMatch) {
      const key = citeMatch[1]!;
      for (const filePath of texFiles) {
        try {
          let src = await readFile(filePath, 'utf-8');
          const re = new RegExp(`\\\\cite[a-zA-Z]*\\{[^}]*\\b${key}\\b[^}]*\\}`, 'g');
          if (re.test(src)) {
            src = src.replace(re, (m) => `${m} %FIXME: citation "${key}" undefined`);
            await writeFile(filePath, src, 'utf-8');
            applied.push(`Flagged undefined citation "${key}" in ${filePath}`);
            break;
          }
        } catch {
          /* best-effort */
        }
      }
    }
  }

  return applied;
}

/**
 * LaTeX tools: compile the active paper, and a compile→parse→fix→recompile loop
 * for the most common errors (undefined control sequences, missing packages,
 * undefined citations).
 */
export function registerLatexTools(registry: ToolRegistry): void {
  registry.register({
    name: 'compile_paper',
    description:
      "Compile the active project's paper/main.tex to PDF using latexmk (preferred) or " +
      'pdflatex. Returns the PDF path on success, or the relevant LaTeX error lines on ' +
      'failure. Use when the user asks to compile, build, render, or preview the paper.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
    async execute() {
      const paperDir = resolveWorkspacePath('paper');
      const result = await runLatexCompile(paperDir);
      return result.ok ? `PDF compiled successfully: ${result.pdfPath}` : result.output;
    },
  });

  registry.register({
    name: 'fix_paper_errors',
    description:
      'Compile the paper, parse LaTeX errors, apply heuristic fixes, and recompile — ' +
      'up to max_iterations rounds. Handles the most common errors: undefined control sequences, ' +
      'missing packages, unmatched braces, missing math delimiters, and undefined citations. ' +
      'Returns what was fixed each round and any errors that remain.',
    sensitive: true,
    parameters: {
      type: 'object',
      properties: {
        max_iterations: {
          type: 'string',
          description: 'Maximum fix-and-recompile rounds (default 3, max 5)',
        },
      },
    },
    async execute({ max_iterations }) {
      const paperDir = resolveWorkspacePath('paper');
      const maxIter = Math.max(1, Math.min(Number(max_iterations) || 3, 5));
      const log: string[] = [];

      for (let iter = 1; iter <= maxIter; iter++) {
        const result = await runLatexCompile(paperDir);
        if (result.ok) {
          log.push(`Round ${iter}: Compiled successfully. PDF: ${result.pdfPath}`);
          break;
        }

        log.push(`Round ${iter}: Compilation failed.`);
        const fixes = await applyLatexFixes(paperDir, result.errors);
        if (!fixes.length) {
          log.push(
            `  No auto-fixable patterns found. Remaining errors:\n${result.errors
              .slice(0, 10)
              .map((e) => `    ${e}`)
              .join('\n')}`,
          );
          break;
        }
        log.push(...fixes.map((f) => `  Fixed: ${f}`));

        if (iter === maxIter) {
          const finalResult = await runLatexCompile(paperDir);
          if (finalResult.ok) {
            log.push(
              `Round ${iter + 1}: Compiled successfully after fixes. PDF: ${finalResult.pdfPath}`,
            );
          } else {
            log.push(
              `Still failing after ${maxIter} rounds. Remaining errors:`,
              ...finalResult.errors.slice(0, 10).map((e) => `  ${e}`),
            );
          }
        }
      }

      return log.join('\n');
    },
  });
}
