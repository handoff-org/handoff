import type { DiffRow } from './diff.js';

/** A single visual entry in the transcript, rendered by `entryLines`. */
export type ChatEntry =
  | { kind: 'user'; content: string }
  | { kind: 'assistant'; content: string }
  | { kind: 'tool_call'; name: string; args: string }
  | { kind: 'tool_result'; name: string; result: string }
  | { kind: 'diff'; path: string; rows: DiffRow[]; added: number; removed: number; truncated: number }
  | { kind: 'note'; content: string }
  | { kind: 'help' }
  | { kind: 'error'; message: string };
