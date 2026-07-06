/**
 * Minimal line-level diff for the "what just changed" box. An LCS pass yields
 * added / removed / context rows; `summarizeDiff` then collapses long unchanged
 * stretches to a little context and caps the total so the box stays small.
 */

export interface DiffRow {
  sign: ' ' | '+' | '-' | '~'; // '~' marks a collapsed gap (⋯)
  text: string;
}

export interface DiffSummary {
  rows: DiffRow[];
  added: number;
  removed: number;
  truncated: number;
}

function lcsDiff(a: string[], b: string[]): DiffRow[] {
  const n = a.length;
  const m = b.length;
  // Guard against pathological sizes: fall back to remove-all / add-all.
  if (n > 2000 || m > 2000 || n * m > 4_000_000) {
    return [
      ...a.map((t) => ({ sign: '-' as const, text: t })),
      ...b.map((t) => ({ sign: '+' as const, text: t })),
    ];
  }
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      rows.push({ sign: ' ', text: a[i]! });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      rows.push({ sign: '-', text: a[i]! });
      i++;
    } else {
      rows.push({ sign: '+', text: b[j]! });
      j++;
    }
  }
  while (i < n) rows.push({ sign: '-', text: a[i++]! });
  while (j < m) rows.push({ sign: '+', text: b[j++]! });
  return rows;
}

/** Diff two texts and return compact rows (changes + a little context). */
export function summarizeDiff(
  oldText: string,
  newText: string,
  context = 2,
  maxRows = 22,
): DiffSummary {
  const a = oldText === '' ? [] : oldText.split('\n');
  const b = newText === '' ? [] : newText.split('\n');
  const all = lcsDiff(a, b);
  const added = all.filter((r) => r.sign === '+').length;
  const removed = all.filter((r) => r.sign === '-').length;

  // Keep only context lines near a change.
  const keep = new Array(all.length).fill(false);
  all.forEach((r, idx) => {
    if (r.sign !== ' ') {
      for (let k = Math.max(0, idx - context); k <= Math.min(all.length - 1, idx + context); k++) {
        keep[k] = true;
      }
    }
  });

  const collapsed: DiffRow[] = [];
  let last = -1;
  for (let idx = 0; idx < all.length; idx++) {
    if (!keep[idx]) continue;
    if (last !== -1 && idx - last > 1) collapsed.push({ sign: '~', text: '⋯' });
    collapsed.push(all[idx]!);
    last = idx;
  }

  let truncated = 0;
  let rows = collapsed;
  if (collapsed.length > maxRows) {
    truncated = collapsed.length - maxRows;
    rows = collapsed.slice(0, maxRows);
  }
  return { rows, added, removed, truncated };
}
