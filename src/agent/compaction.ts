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
 * the oldest turns are dropped once a token budget is exceeded — replaced by a
 * short factual digest of what they contained, so the model keeps a gist rather
 * than a blank.
 *
 * No model call, no LLM summarisation — the digest is extracted deterministically
 * from the dropped messages, so the whole function stays pure and unit-testable.
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
  /** Cap for the digest that replaces dropped turns, in characters. */
  summaryCapChars?: number;
}

// Shown when tool output was shortened but no whole turn was dropped.
const TRUNCATE_NOTE = '[earlier tool output shortened to fit the context budget]';
const DEFAULT_TOOL_CAP = 800;
const DEFAULT_SUMMARY_CAP = 800;

type Block = Message[];

/** Collapse whitespace/newlines and clip to `max` chars (appending … if cut). */
function clip(s: string, max: number): string {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > max ? one.slice(0, max).trimEnd() + '…' : one;
}

/**
 * Build a compact, deterministic digest of the dropped blocks so the model keeps
 * a gist of the trimmed-away history: one line per turn (what the user asked /
 * what the assistant did + which tools it ran), bounded to `capChars`.
 */
function summarizeDroppedBlocks(dropped: Block[], capChars: number): string {
  const lines: string[] = [];
  for (const block of dropped) {
    const lead = block.find((m) => m.role !== 'tool') ?? block[0]!;
    if (lead.role === 'user') {
      lines.push(`you: ${clip(lead.content ?? '', 100)}`);
    } else if (lead.role === 'assistant') {
      const names = [
        ...new Set(
          block.flatMap((m) => (m.tool_calls ?? []).map((c) => c.function.name)),
        ),
      ];
      const text = clip(lead.content ?? '', 80);
      let entry = text ? `assistant: ${text}` : 'assistant made tool calls';
      if (names.length) entry += ` [ran: ${names.join(', ')}]`;
      lines.push(entry);
    } else {
      lines.push(`${lead.role}: ${clip(lead.content ?? '', 80)}`);
    }
  }
  const header = `[earlier conversation summary — ${dropped.length} turn${dropped.length === 1 ? '' : 's'} trimmed to fit the context budget]`;
  const digest = `${header}\n${lines.join('\n')}`;
  return digest.length > capChars ? digest.slice(0, capChars).trimEnd() + '…' : digest;
}

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
  const summaryCap = opts.summaryCapChars ?? DEFAULT_SUMMARY_CAP;
  if (messages.length <= 1) return messages.slice();

  const hasSystem = messages[0]!.role === 'system';
  const head: Message[] = hasSystem ? [messages[0]!] : [];
  const rest = hasSystem ? messages.slice(1) : messages.slice();
  if (rest.length === 0) return messages.slice();

  const blocks = groupBlocks(rest);
  const headTokens = estimateMessagesTokens(head);
  // Reserve room for the digest that may replace dropped turns. A conservative
  // fixed reserve (a cap-length string) means the actual digest — always ≤ cap —
  // is guaranteed to fit, so budget + output reserve can't overflow the window.
  const summaryReserve = estimateMessagesTokens([{ role: 'system', content: 'x'.repeat(summaryCap) }]);

  // Reserve room for head + a possible summary; the rest is for blocks.
  const available = opts.maxPromptTokens - headTokens - summaryReserve;

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

  const out: Message[] = [...head];
  // Replace dropped turns with a factual digest so the model keeps their gist;
  // if turns were only truncated (nothing fully dropped), a short note suffices.
  if (droppedAny) {
    const dropped = blocks.filter((_, i) => kept[i] === null);
    out.push({ role: 'system', content: summarizeDroppedBlocks(dropped, summaryCap) });
  } else if (truncatedAny) {
    out.push({ role: 'system', content: TRUNCATE_NOTE });
  }
  for (let i = 0; i < blocks.length; i++) {
    const b = kept[i];
    if (b) out.push(...b);
  }
  return out;
}
