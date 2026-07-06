/**
 * Parse JSON Lines (one JSON object per line) resiliently. A single malformed
 * line — e.g. a half-written record from a process killed mid-append — must not
 * discard the entire file, so each line is parsed independently and bad lines
 * are skipped rather than aborting the whole read.
 */
export function parseJsonl<T>(text: string): T[] {
  const out: T[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed) as T);
    } catch {
      // Skip only this corrupt line; keep every valid record.
    }
  }
  return out;
}
