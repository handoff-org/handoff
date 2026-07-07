import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compactHistory } from '../src/agent/compaction.js';
import { estimateMessagesTokens } from '../src/agent/contextBudget.js';
import type { Message } from '../src/agent/model.js';

const sys: Message = { role: 'system', content: 'SYSTEM PROMPT' };

/** A user/assistant exchange of roughly `chars` characters each. */
function exchange(tag: string, chars: number): Message[] {
  return [
    { role: 'user', content: `${tag}-user ${'u'.repeat(chars)}` },
    { role: 'assistant', content: `${tag}-assistant ${'a'.repeat(chars)}` },
  ];
}

test('no-op when the whole history is already under budget', () => {
  const msgs: Message[] = [sys, ...exchange('t1', 40), ...exchange('t2', 40)];
  const out = compactHistory(msgs, { maxPromptTokens: 100000 });
  assert.deepEqual(out, msgs);
});

test('system message is kept byte-identical', () => {
  const msgs: Message[] = [sys, ...exchange('t1', 4000), ...exchange('t2', 4000), ...exchange('t3', 40)];
  const out = compactHistory(msgs, { maxPromptTokens: 500 });
  assert.equal(out[0]!.role, 'system');
  assert.equal(out[0]!.content, 'SYSTEM PROMPT');
});

test('recent turns kept verbatim; oldest dropped; replaced by one digest', () => {
  const msgs: Message[] = [sys, ...exchange('old', 8000), ...exchange('recent', 40)];
  const out = compactHistory(msgs, { maxPromptTokens: 400 });
  const text = out.map((m) => m.content).join('\n');
  // Recent exchange survives verbatim.
  assert.match(text, /recent-user/);
  assert.match(text, /recent-assistant/);
  // The old exchange is gone verbatim, but its gist survives in the digest.
  assert.doesNotMatch(text, /u{200}/); // the full 8000-char old content is not present
  const digests = out.filter((m) => m.content.includes('earlier conversation summary'));
  assert.equal(digests.length, 1, 'exactly one digest, inserted once');
  assert.match(digests[0]!.content, /you: old-user/);
  assert.match(digests[0]!.content, /assistant: old-assistant/);
});

test('the digest captures dropped tool calls and respects its cap', () => {
  const msgs: Message[] = [
    sys,
    { role: 'user', content: 'add authentication to the app' },
    {
      role: 'assistant',
      content: '',
      tool_calls: [{ id: '1', type: 'function', function: { name: 'write_file', arguments: '{}' } }],
    },
    { role: 'tool', content: 'ok', tool_call_id: '1' },
    // A large current turn that is always kept and pushes the older turns out.
    { role: 'user', content: 'X'.repeat(4000) },
  ];
  const out = compactHistory(msgs, { maxPromptTokens: 300, summaryCapChars: 400 });
  const digest = out.find((m) => m.role === 'system' && m.content.includes('earlier conversation summary'));
  assert.ok(digest, 'a digest system message should be inserted');
  assert.match(digest!.content, /you: add authentication/);
  assert.match(digest!.content, /ran: write_file/); // the dropped tool call is named
  assert.ok(digest!.content.length <= 400, `digest over cap: ${digest!.content.length}`);
});

test('truncation with no full drops inserts a short note, not a summary', () => {
  const bigTool = 'X'.repeat(8000);
  const msgs: Message[] = [
    sys,
    { role: 'user', content: 'run it' },
    {
      role: 'assistant',
      content: '',
      tool_calls: [{ id: '1', type: 'function', function: { name: 'run', arguments: '{}' } }],
    },
    { role: 'tool', content: bigTool, tool_call_id: '1' },
    ...exchange('recent', 40),
  ];
  const out = compactHistory(msgs, { maxPromptTokens: 1200, toolCapChars: 200 });
  const notes = out.filter((m) => m.role === 'system' && m.content.startsWith('[earlier'));
  assert.equal(notes.length, 1);
  assert.match(notes[0]!.content, /tool output shortened/);
  assert.doesNotMatch(notes[0]!.content, /summary/);
});

test('old tool output is capped rather than dropped when it can fit truncated', () => {
  const bigTool = 'X'.repeat(8000);
  const msgs: Message[] = [
    sys,
    { role: 'user', content: 'run it' },
    {
      role: 'assistant',
      content: '',
      tool_calls: [{ id: '1', type: 'function', function: { name: 'run', arguments: '{}' } }],
    },
    { role: 'tool', content: bigTool, tool_call_id: '1' },
    ...exchange('recent', 40),
  ];
  const out = compactHistory(msgs, { maxPromptTokens: 1200, toolCapChars: 200 });
  const toolMsg = out.find((m) => m.role === 'tool');
  // Kept, but capped well below the original 8000 chars.
  assert.ok(toolMsg, 'tool message should be retained (truncated)');
  assert.ok(toolMsg!.content.length < 400);
  assert.match(toolMsg!.content, /truncated to fit context budget/);
});

test('tool_call ↔ tool_result pairing is preserved (no orphan tool messages)', () => {
  const msgs: Message[] = [
    sys,
    ...exchange('filler', 8000), // will be dropped
    { role: 'user', content: 'do a thing' },
    {
      role: 'assistant',
      content: '',
      tool_calls: [{ id: 'abc', type: 'function', function: { name: 'run', arguments: '{}' } }],
    },
    { role: 'tool', content: 'result', tool_call_id: 'abc' },
    { role: 'assistant', content: 'done' },
  ];
  const out = compactHistory(msgs, { maxPromptTokens: 400 });
  // Every tool message must have its parent assistant tool_call present.
  const callIds = new Set<string>();
  for (const m of out) {
    if (m.role === 'assistant' && m.tool_calls) for (const c of m.tool_calls) callIds.add(c.id);
  }
  for (const m of out) {
    if (m.role === 'tool') assert.ok(callIds.has(m.tool_call_id!), `orphan tool result ${m.tool_call_id}`);
  }
  // And an assistant tool_call must have its result present.
  const resultIds = new Set(out.filter((m) => m.role === 'tool').map((m) => m.tool_call_id));
  for (const id of callIds) assert.ok(resultIds.has(id), `tool_call ${id} lost its result`);
});

test('result stays within budget when head + last block allow it', () => {
  const msgs: Message[] = [sys, ...exchange('a', 6000), ...exchange('b', 6000), ...exchange('c', 40)];
  const budget = 600;
  const out = compactHistory(msgs, { maxPromptTokens: budget });
  assert.ok(estimateMessagesTokens(out) <= budget, `over budget: ${estimateMessagesTokens(out)} > ${budget}`);
});

test('history with no system message still compacts safely', () => {
  const msgs: Message[] = [...exchange('old', 8000), ...exchange('recent', 40)];
  const out = compactHistory(msgs, { maxPromptTokens: 400 });
  assert.match(out.map((m) => m.content).join('\n'), /recent-user/);
});
