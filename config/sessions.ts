import { readFile, writeFile, mkdir, rename } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import type { Message } from '../src/agent/model.js';
import { redactSecrets } from '../src/util/redact.js';

const SESSION_DIR = join(homedir(), '.handoff', 'sessions');
const LAST_FILE = join(SESSION_DIR, 'last.json');

export interface SavedSession {
  savedAt: string;
  history: Message[];
  /** UI entries (kept opaque here to avoid coupling to the UI layer). */
  entries: unknown[];
}

/**
 * Redact secret-looking tool-call arguments before they're written to disk. A
 * model-invoked `overleaf_link` (or similar) carries a Git token in its args;
 * without this it would land verbatim in ~/.handoff/sessions/last.json and
 * survive across runs. We clone rather than mutate the live in-memory state.
 */
function redactHistory(history: Message[]): Message[] {
  return history.map((m) =>
    m.tool_calls?.length
      ? {
          ...m,
          tool_calls: m.tool_calls.map((tc) => ({
            ...tc,
            function: { ...tc.function, arguments: redactSecrets(tc.function.arguments) },
          })),
        }
      : m,
  );
}

function redactEntries(entries: unknown[]): unknown[] {
  return entries.map((e) => {
    const entry = e as { kind?: string; args?: string };
    if (entry && entry.kind === 'tool_call' && typeof entry.args === 'string') {
      return { ...entry, args: redactSecrets(entry.args) };
    }
    return e;
  });
}

export async function saveSession(history: Message[], entries: unknown[]): Promise<void> {
  try {
    await mkdir(SESSION_DIR, { recursive: true });
    const data: SavedSession = {
      savedAt: new Date().toISOString(),
      history: redactHistory(history),
      entries: redactEntries(entries),
    };
    // Atomic: write a temp file then rename, so a crash mid-write can't leave a
    // truncated last.json that loses the whole conversation.
    const tmp = `${LAST_FILE}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(data), 'utf-8');
    await rename(tmp, LAST_FILE);
  } catch {
    // Persisting sessions is best-effort; never crash the app over it.
  }
}

export async function loadLastSession(): Promise<SavedSession | null> {
  try {
    const raw = await readFile(LAST_FILE, 'utf-8');
    return JSON.parse(raw) as SavedSession;
  } catch {
    return null;
  }
}

interface EntryLike {
  kind?: string;
  content?: string;
  name?: string;
  args?: string;
}

/** Build a short "what happened this session" recap from the saved entries. */
export function summarizeSession(session: SavedSession): { label: string; value: string }[] {
  const entries = (session.entries ?? []) as EntryLike[];
  const users = entries.filter((e) => e.kind === 'user');
  const replies = entries.filter((e) => e.kind === 'assistant').length;
  const toolCalls = entries.filter((e) => e.kind === 'tool_call');

  const tally = new Map<string, number>();
  const files = new Set<string>();
  for (const tc of toolCalls) {
    if (tc.name) tally.set(tc.name, (tally.get(tc.name) ?? 0) + 1);
    if ((tc.name === 'write_file' || tc.name === 'make_dir') && tc.args) {
      try {
        const a = JSON.parse(tc.args) as { path?: unknown };
        if (a.path) files.add(String(a.path));
      } catch {
        /* ignore unparseable args */
      }
    }
  }

  const out: { label: string; value: string }[] = [];
  const topic = users[0]?.content?.replace(/\s+/g, ' ').trim();
  if (topic)
    out.push({ label: 'topic', value: topic.length > 64 ? topic.slice(0, 64) + '…' : topic });
  out.push({
    label: 'turns',
    value: `${users.length} message${users.length === 1 ? '' : 's'} · ${replies} repl${replies === 1 ? 'y' : 'ies'}`,
  });
  if (tally.size) {
    out.push({
      label: 'tools',
      value: Array.from(tally.entries())
        .map(([n, c]) => `${n}×${c}`)
        .join(', '),
    });
  }
  if (files.size) {
    const list = Array.from(files);
    out.push({
      label: 'files',
      value: list.slice(0, 5).join(', ') + (list.length > 5 ? ` (+${list.length - 5})` : ''),
    });
  }
  return out;
}
