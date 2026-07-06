import type { Message } from './model.js';
import { estimateMessagesTokens } from './contextBudget.js';

/**
 * Deterministic, protocol-safe history compaction for laptop context budgets.
 *
 * The agent loop otherwise re-sends the entire conversation — including full
 * tool outputs — on every turn, so prefill cost (and heat) grows without bound.
 * This trims what the model *sees* each turn while the caller keeps the full
 * history on disk: the system message stays byte-identical (protecting backend
 * prompt caching), recent turns stay verbatim, older tool output is capped, and
 * the oldest turns are dropped once a token budget is exceeded.
 *
 * No model call, no summarisation — fully deterministic and unit-testable.
 *
 * Protocol safety: an assistant message that issued `tool_calls` is grouped with
 * its following `tool` result messages into one atomic block, so we never orphan
 * a tool result from its parent call or keep a call whose results were dropped.
 * Dropped blocks are always the oldest contiguous prefix, so the kept messages
 * stay a contiguous suffix (no holes in the middle).
 */

export interface CompactionOptions {
  /** Target prompt-token budget for the sent history. */
  maxPromptTokens: number;
  /** Cap for an individual old tool message's content, in characters. */
  toolCapChars?: number;
}

const MARKER = '[earlier conversation trimmed to fit the context budget]';
const DEFAULT_TOOL_CAP = 800;

type Block = Message[];

/**
 * Group the non-system messages into atomic blocks. A new block starts at each
 * user/assistant message; `tool` messages attach to the current block (so an
 * assistant's tool_calls travel with their results).
 */
function groupBlocks(rest: Message[]): Block[] {
  const blocks: Block[] = [];
  let cur: Block | null = null;
  for (const m of rest) {
    if (m.role === 'tool') {
      if (cur) cur.push(m);
      else cur = [m]; // orphan tool (shouldn't happen) — start a block so it's not lost
    } else {
      if (cur) blocks.push(cur);
      cur = [m];
    }
  }
  if (cur) blocks.push(cur);
  return blocks;
}

/** Cap oversized tool outputs inside a block; other messages pass through. */
function truncateTools(block: Block, cap: number): Block {
  return block.map((m) =>
    m.role === 'tool' && m.content.length > cap
      ? { ...m, content: m.content.slice(0, cap) + '\n… (truncated to fit context budget)' }
      : m,
  );
}

export function compactHistory(messages: Message[], opts: CompactionOptions): Message[] {
  const cap = opts.toolCapChars ?? DEFAULT_TOOL_CAP;
  if (messages.length <= 1) return messages.slice();

  const hasSystem = messages[0]!.role === 'system';
  const head: Message[] = hasSystem ? [messages[0]!] : [];
  const rest = hasSystem ? messages.slice(1) : messages.slice();
  if (rest.length === 0) return messages.slice();

  const blocks = groupBlocks(rest);
  const headTokens = estimateMessagesTokens(head);
  const markerTokens = estimateMessagesTokens([{ role: 'system', content: MARKER }]);

  // Reserve room for head + a possible trim marker; the rest is for blocks.
  const available = opts.maxPromptTokens - headTokens - markerTokens;

  // Walk newest → oldest. The last block (current turn / latest tool results) is
  // always kept verbatim, even if it alone blows the budget — we never drop the
  // current turn or break protocol. `kept[i]` holds the version to send, or null
  // if dropped.
  const kept: (Block | null)[] = new Array(blocks.length).fill(null);
  let used = 0;
  let truncatedAny = false;
  let droppedAny = false;

  const lastIdx = blocks.length - 1;
  kept[lastIdx] = blocks[lastIdx]!;
  used += estimateMessagesTokens(blocks[lastIdx]!);

  for (let i = lastIdx - 1; i >= 0; i--) {
    if (used >= available) {
      droppedAny = true;
      continue; // everything from here down is older → dropped
    }
    const block = blocks[i]!;
    const full = estimateMessagesTokens(block);
    if (used + full <= available) {
      kept[i] = block;
      used += full;
      continue;
    }
    const trunc = truncateTools(block, cap);
    const tt = estimateMessagesTokens(trunc);
    if (used + tt <= available && tt < full) {
      kept[i] = trunc;
      used += tt;
      truncatedAny = true;
    } else {
      droppedAny = true; // even truncated won't fit → drop it (and older)
    }
  }

  const trimmed = droppedAny || truncatedAny;
  const out: Message[] = [...head];
  if (trimmed) out.push({ role: 'system', content: MARKER });
  for (let i = 0; i < blocks.length; i++) {
    const b = kept[i];
    if (b) out.push(...b);
  }
  return out;
}
