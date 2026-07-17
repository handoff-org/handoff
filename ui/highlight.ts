/**
 * Tiny, dependency-free syntax highlighter for fenced code blocks.
 *
 * It is intentionally approximate — a single left-to-right pass per line that
 * colors comments, strings, numbers, language keywords, and call/def names.
 * Multi-line constructs (block comments, triple-quoted strings) are only tracked
 * within a line. The palette is a fixed VS Code-style "One Dark" set so code
 * reads the same across every handoff theme.
 */

export interface Span {
  text: string;
  color?: string;
}

const SYNTAX = {
  keyword: '#c678dd', // purple
  string: '#98c379', // green
  comment: '#7f848e', // gray
  number: '#d19a66', // orange
  func: '#61afef', // blue
};

type Lang = 'python' | 'js' | 'bash' | 'generic';

function normalizeLang(langRaw: string): Lang {
  const l = langRaw.toLowerCase();
  if (['py', 'python'].includes(l)) return 'python';
  if (['js', 'jsx', 'ts', 'tsx', 'javascript', 'typescript', 'json', 'node'].includes(l))
    return 'js';
  if (['sh', 'bash', 'shell', 'zsh', 'console'].includes(l)) return 'bash';
  return 'generic';
}

const KEYWORDS: Record<Lang, Set<string>> = {
  python: new Set(
    'def class return if elif else for while import from as with try except finally lambda pass break continue yield global nonlocal raise assert del async await in is and or not None True False self print'.split(
      ' ',
    ),
  ),
  js: new Set(
    'const let var function return if else for while import from export default class new try catch finally throw typeof instanceof in of await async yield switch case break continue this null undefined true false extends super void delete do public private protected interface type enum implements readonly'.split(
      ' ',
    ),
  ),
  bash: new Set(
    'if then else elif fi for while do done case esac function in return export local echo cd source set unset read sudo'.split(
      ' ',
    ),
  ),
  generic: new Set(
    'if else for while return function class def import export const let var true false null None True False public private static void new try catch then end and or not'.split(
      ' ',
    ),
  ),
};

const IDENT_START = /[A-Za-z_$]/;
const IDENT = /[A-Za-z0-9_$]/;

/** Color one line of code into styled spans for the given language label. */
export function highlight(line: string, langRaw: string): Span[] {
  const lang = normalizeLang(langRaw);
  const kw = KEYWORDS[lang];
  const spans: Span[] = [];
  const push = (text: string, color?: string) => {
    if (text) spans.push(color ? { text, color } : { text });
  };

  const n = line.length;
  let i = 0;
  while (i < n) {
    const c = line[i]!;
    const two = line.slice(i, i + 2);

    // Line comments.
    const hashComment = c === '#' && lang !== 'js';
    const slashComment = two === '//' && (lang === 'js' || lang === 'generic');
    if (hashComment || slashComment) {
      push(line.slice(i), SYNTAX.comment);
      break;
    }
    // Block comment (single line slice only).
    if (two === '/*' && (lang === 'js' || lang === 'generic')) {
      const end = line.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      push(line.slice(i, stop), SYNTAX.comment);
      i = stop;
      continue;
    }

    // Strings (single/double/backtick) with backslash escapes.
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < n && line[j] !== c) {
        if (line[j] === '\\') j++;
        j++;
      }
      const stop = Math.min(j + 1, n);
      push(line.slice(i, stop), SYNTAX.string);
      i = stop;
      continue;
    }

    // Numbers (incl. hex / decimals).
    if (c >= '0' && c <= '9') {
      let j = i;
      while (j < n && /[0-9._xXa-fA-F]/.test(line[j]!)) j++;
      push(line.slice(i, j), SYNTAX.number);
      i = j;
      continue;
    }

    // Identifiers → keyword / function-call / plain.
    if (IDENT_START.test(c)) {
      let j = i + 1;
      while (j < n && IDENT.test(line[j]!)) j++;
      const word = line.slice(i, j);
      let k = j;
      while (k < n && line[k] === ' ') k++;
      const isCall = line[k] === '(';
      if (kw.has(word)) push(word, SYNTAX.keyword);
      else if (isCall) push(word, SYNTAX.func);
      else push(word);
      i = j;
      continue;
    }

    push(c);
    i++;
  }

  return spans.length ? spans : [{ text: line }];
}
