import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'fs/promises';
import { join } from 'path';
import { freshHome } from './helpers.js';

// Isolate HOME before importing — SESSION_DIR is fixed at module load.
const home = freshHome();
const { saveSession, loadLastSession } = await import('../config/sessions.js');
const lastFile = join(home, '.handoff', 'sessions', 'last.json');

const SECRET = 'tok_SECRET123';
const ARGS = `{"url":"https://www.overleaf.com/project/abc","token":"${SECRET}"}`;

test('saveSession redacts a token in tool-call args (history + entries)', async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const history: any = [
    { role: 'user', content: 'link my overleaf' },
    {
      role: 'assistant',
      content: '',
      tool_calls: [
        { id: 'c0', type: 'function', function: { name: 'overleaf_link', arguments: ARGS } },
      ],
    },
  ];
  const entries = [{ kind: 'tool_call', name: 'overleaf_link', args: ARGS }];

  await saveSession(history, entries);
  const raw = await readFile(lastFile, 'utf-8');
  assert.ok(!raw.includes(SECRET), 'the token leaked into last.json');
  assert.ok(await loadLastSession(), 'session should still round-trip as valid JSON');
});

test("saveSession does not mutate the caller's live in-memory history", async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const history: any = [
    {
      role: 'assistant',
      content: '',
      tool_calls: [{ id: 'c', type: 'function', function: { name: 'x', arguments: ARGS } }],
    },
  ];
  await saveSession(history, []);
  assert.equal(
    history[0].tool_calls[0].function.arguments,
    ARGS,
    'live history must not be mutated',
  );
});

test('saveSession writes a timestamped, indented archive of the run (not just last.json)', async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await saveSession([{ role: 'user', content: 'hi' }] as any, []);
  const dir = join(home, '.handoff', 'sessions');
  const archive = (await readdir(dir)).find((f) => /^session-.*\.json$/.test(f));
  assert.ok(archive, 'a timestamped session archive should be written');
  const raw = await readFile(join(dir, archive!), 'utf-8');
  assert.match(raw, /\n {2}"savedAt"/, 'archive JSON should be indented');
  // last.json is indented too, for readability.
  assert.match(
    await readFile(lastFile, 'utf-8'),
    /\n {2}"savedAt"/,
    'last.json should be indented',
  );
});
