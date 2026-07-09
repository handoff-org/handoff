import React from 'react';
import { Text } from 'ink';
import { basename } from 'path';
import { renderInline } from './Markdown.js';
import { highlight } from './highlight.js';
import { COMMANDS } from './commands.js';
import { hexToRgb, mix, rgbToHex } from './color.js';
import { cellWidth, sliceToWidth } from './width.js';
import type { ChatEntry } from './types.js';
import type { Theme } from '../config/theme.js';

/** Word-wrap plain text to a width, hard-splitting over-long words. Measures in
 * terminal cells (CJK/emoji = 2, combining marks = 0, ANSI = 0) so wide text
 * neither overflows nor wraps early. */
export function wrap(text: string, width: number): string[] {
  const w = Math.max(4, width);
  if (text.length === 0) return [''];
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let cur = '';
    for (const word of para.split(' ')) {
      let piece = word;
      // Hard-split a word wider than the line.
      while (cellWidth(piece) > w) {
        if (cur) {
          out.push(cur);
          cur = '';
        }
        const { head, rest } = sliceToWidth(piece, w);
        // Guard against zero progress (e.g. a lone 2-wide char in a 1-col line).
        if (head === '') {
          const chars = [...piece];
          out.push(chars[0] ?? '');
          piece = chars.slice(1).join('');
        } else {
          out.push(head);
          piece = rest;
        }
      }
      if (cur === '') cur = piece;
      else if (cellWidth(cur + ' ' + piece) <= w) cur += ' ' + piece;
      else {
        out.push(cur);
        cur = piece;
      }
    }
    out.push(cur);
  }
  return out;
}

const SPACER = (key: string) => <Text key={key}> </Text>;

// Dark background tint so user messages read as a distinct block.
const USER_BG = '#2b2b33';

/** A dark tint of a theme color, for full-bleed shaded status blocks. */
function tintBg(hex: string): string {
  return rgbToHex(mix(hexToRgb(hex), [0, 0, 0], 0.8));
}

interface Emitted {
  marker: React.ReactNode;
  color?: string;
  text: string;
  inline?: boolean;
}

/** Lay out one emitted block (marker + body text) into wrapped line elements. */
/**
 * Shorten a tool result for *display* only (the model still receives the full
 * result). Tool output — file reads, run logs, dir listings — is often long and
 * would otherwise dominate the transcript. Caps to a few lines / chars and notes
 * how much was hidden.
 */
function truncateResult(text: string, maxLines = 6, maxChars = 400): string {
  const lines = text.split('\n');
  let hiddenLines = 0;
  let t = text;
  if (lines.length > maxLines) {
    hiddenLines = lines.length - maxLines;
    t = lines.slice(0, maxLines).join('\n');
  }
  if (t.length > maxChars) {
    return t.slice(0, maxChars).trimEnd() + '\n… (truncated — full output kept in context)';
  }
  if (hiddenLines > 0) {
    return t + `\n… (+${hiddenLines} more line${hiddenLines === 1 ? '' : 's'})`;
  }
  return t;
}

function layout(
  blocks: Emitted[],
  width: number,
  theme: Theme,
  keyBase: string,
): React.ReactNode[] {
  const lines: React.ReactNode[] = [];
  let firstOfEntry = true;
  for (const b of blocks) {
    const wrapped = wrap(b.text, width - 2);
    wrapped.forEach((ln, i) => {
      const marker = i === 0 ? b.marker : <Text> </Text>;
      lines.push(
        <Text key={`${keyBase}-${lines.length}`}>
          {marker}
          {b.inline ? renderInline(ln, theme) : <Text color={b.color}>{ln}</Text>}
        </Text>,
      );
    });
    firstOfEntry = false;
  }
  void firstOfEntry;
  return lines;
}

/** Convert a chat entry into exact, wrapped, styled visual lines. */
export function entryLines(
  entry: ChatEntry,
  theme: Theme,
  width: number,
  keyBase: string,
): React.ReactNode[] {
  const lead = SPACER(`${keyBase}-lead`);

  switch (entry.kind) {
    case 'user': {
      // A darker, full-width block so the user's turn stands out from replies.
      const w = Math.max(12, width - 2);
      const innerW = w - 2; // one space of padding on each side
      const wrapped = wrap(entry.content, innerW - 2); // room for the "› " marker
      const rows: React.ReactNode[] = [lead];
      wrapped.forEach((ln, i) => {
        const prefix = i === 0 ? '› ' : '  ';
        const padW = Math.max(0, innerW - prefix.length - ln.length);
        rows.push(
          <Text key={`${keyBase}-u${i}`} backgroundColor={USER_BG}>
            {' '}
            <Text color={theme.user} bold={i === 0}>
              {prefix}
            </Text>
            <Text color={theme.user}>{ln}</Text>
            {' '.repeat(padW)}{' '}
          </Text>,
        );
      });
      return rows;
    }
    case 'assistant':
      return [lead, ...assistantLines(entry.content, theme, width, keyBase)];
    case 'tool_call':
      return [
        lead,
        ...layout(
          [{ marker: <Text color={theme.tool}>{'⚒ '}</Text>, color: undefined, text: entry.name }],
          width,
          theme,
          keyBase,
        ),
      ];
    case 'tool_result':
      return layout(
        [
          {
            marker: <Text color={theme.toolResult}>{'↳ '}</Text>,
            color: 'gray',
            text: truncateResult(entry.result),
          },
        ],
        width,
        theme,
        keyBase,
      );
    case 'diff': {
      // A compact GitHub-style change box: green additions, red deletions.
      // The whole box is indented one "tab" past the chat margin so applied
      // edits read as a nested, set-apart artifact rather than a chat line.
      const ind = DIFF_INDENT;
      const border = theme.note;
      const maxInner = Math.max(24, Math.min(width - 4 - ind.length, 88));
      const titleText = `± ${basename(entry.path)}`;
      const statText = `+${entry.added} −${entry.removed}`;
      const titleLen = titleText.length + 2 + statText.length;
      const innerW = Math.max(
        24,
        Math.min(maxInner, Math.max(titleLen, ...entry.rows.map((r) => r.text.length + 1))),
      );
      const out: React.ReactNode[] = [lead];
      out.push(
        <Text key={`${keyBase}-dtop`} color={border} dimColor>
          {ind + '╭' + '─'.repeat(innerW + 2) + '╮'}
        </Text>,
      );
      out.push(
        <Text key={`${keyBase}-dttl`}>
          <Text color={border} dimColor>
            {ind + '│ '}
          </Text>
          <Text color={theme.assistant} bold>
            {titleText}
          </Text>
          <Text>{'  '}</Text>
          <Text dimColor>{statText}</Text>
          <Text>{' '.repeat(Math.max(0, innerW - titleLen))}</Text>
          <Text color={border} dimColor>
            {' │'}
          </Text>
        </Text>,
      );
      for (const r of entry.rows) {
        const color = r.sign === '+' ? DIFF_ADD : r.sign === '-' ? DIFF_DEL : undefined;
        const bg = r.sign === '+' ? DIFF_ADD_BG : r.sign === '-' ? DIFF_DEL_BG : undefined;
        const segs = r.sign === '~' ? ['⋯'] : hardWrap(r.text, innerW - 1);
        segs.forEach((seg, si) => {
          const s = si === 0 && r.sign !== '~' ? r.sign : ' ';
          const body = (s + seg).padEnd(innerW);
          out.push(
            <Text key={`${keyBase}-d${out.length}`}>
              <Text color={border} dimColor>
                {ind + '│ '}
              </Text>
              {r.sign === '~' || r.sign === ' ' ? (
                <Text dimColor>{body}</Text>
              ) : (
                <Text color={color} backgroundColor={bg}>
                  {body}
                </Text>
              )}
              <Text color={border} dimColor>
                {' │'}
              </Text>
            </Text>,
          );
        });
      }
      if (entry.truncated > 0) {
        const more = `… ${entry.truncated} more line${entry.truncated === 1 ? '' : 's'}`;
        out.push(
          <Text key={`${keyBase}-dmore`}>
            <Text color={border} dimColor>
              {ind + '│ '}
            </Text>
            <Text dimColor>{more.padEnd(innerW)}</Text>
            <Text color={border} dimColor>
              {' │'}
            </Text>
          </Text>,
        );
      }
      out.push(
        <Text key={`${keyBase}-dbot`} color={border} dimColor>
          {ind + '╰' + '─'.repeat(innerW + 2) + '╯'}
        </Text>,
      );
      return out;
    }
    case 'note': {
      // A full-width block shaded to the theme, no border — matches the look of
      // the user's own turn so status lines read as part of the flow.
      const w = Math.max(12, width - 2);
      const innerW = w - 2; // one space of padding on each side
      const bg = tintBg(theme.note);
      const wrapped = wrap(entry.content, innerW);
      const rows: React.ReactNode[] = [lead];
      wrapped.forEach((ln, i) => {
        const padW = Math.max(0, innerW - ln.length);
        rows.push(
          <Text key={`${keyBase}-n${i}`} backgroundColor={bg}>
            {' '}
            <Text color={theme.note}>{ln}</Text>
            {' '.repeat(padW)}{' '}
          </Text>,
        );
      });
      return rows;
    }
    case 'help': {
      // A titled panel listing every slash command — aligned name + dim desc.
      const c = theme.note;
      const nameW = Math.max(...COMMANDS.map((cmd) => cmd.name.length));
      const innerCap = Math.max(20, Math.min(width - 4, 80));
      const innerW = Math.min(
        innerCap,
        Math.max(' Commands'.length, ...COMMANDS.map((cmd) => 1 + nameW + 2 + cmd.desc.length)),
      );
      const rows: React.ReactNode[] = [lead];
      rows.push(
        <Text key={`${keyBase}-htop`} color={c} dimColor>
          {'╭' + '─'.repeat(innerW + 2) + '╮'}
        </Text>,
      );
      const title = 'Commands';
      rows.push(
        <Text key={`${keyBase}-htitle`}>
          <Text color={c} dimColor>
            {'│ '}
          </Text>
          <Text color={theme.assistant} bold>
            {title.padEnd(innerW)}
          </Text>
          <Text color={c} dimColor>
            {' │'}
          </Text>
        </Text>,
      );
      for (const cmd of COMMANDS) {
        const line = ` ${cmd.name.padEnd(nameW)}  ${cmd.desc}`;
        for (const seg of hardWrap(line, innerW)) {
          // Color just the command name on the first wrapped segment.
          const isFirst = seg.startsWith(` ${cmd.name}`);
          rows.push(
            <Text key={`${keyBase}-h${rows.length}`}>
              <Text color={c} dimColor>
                {'│ '}
              </Text>
              {isFirst ? (
                [
                  <Text key="nm" color={theme.user}>{` ${cmd.name}`}</Text>,
                  <Text key="ds" dimColor>
                    {seg.slice(1 + cmd.name.length).padEnd(innerW - 1 - cmd.name.length)}
                  </Text>,
                ]
              ) : (
                <Text dimColor>{seg.padEnd(innerW)}</Text>
              )}
              <Text color={c} dimColor>
                {' │'}
              </Text>
            </Text>,
          );
        }
      }
      rows.push(
        <Text key={`${keyBase}-hbot`} color={c} dimColor>
          {'╰' + '─'.repeat(innerW + 2) + '╯'}
        </Text>,
      );
      return rows;
    }
    case 'error':
      return [
        lead,
        ...layout(
          [
            {
              marker: (
                <Text color={theme.error} bold>
                  {'✗ '}
                </Text>
              ),
              color: theme.error,
              text: entry.message,
            },
          ],
          width,
          theme,
          keyBase,
        ),
      ];
    default:
      return [];
  }
}

/** Hard-split a string into chunks of at most w display cells (no word breaks). */
function hardWrap(s: string, w: number): string[] {
  if (cellWidth(s) <= w) return [s];
  const out: string[] = [];
  let rest = s;
  while (cellWidth(rest) > w) {
    const { head, rest: tail } = sliceToWidth(rest, w);
    if (head === '') {
      // A single char wider than w — emit it alone to guarantee progress.
      const chars = [...rest];
      out.push(chars[0] ?? '');
      rest = chars.slice(1).join('');
    } else {
      out.push(head);
      rest = tail;
    }
  }
  if (rest) out.push(rest);
  return out;
}

// GitHub-style diff colors (matte): green additions, red deletions.
const DIFF_ADD = '#4d9e5f';
const DIFF_DEL = '#c75c54';
const DIFF_ADD_BG = '#13271b';
const DIFF_DEL_BG = '#2c1618';

// One "tab" of indent so the diff box sits set-apart from chat messages.
const DIFF_INDENT = '   ';

function looksLikeDiff(lang: string, code: string[]): boolean {
  if (lang === 'diff' || lang === 'patch') return true;
  if (lang) return false; // a named non-diff language
  const marks = code.filter((l) => /^[+\-@]/.test(l)).length;
  return marks >= 2 && marks >= code.length * 0.4;
}

/**
 * Render a fenced code block Claude-Code/GitHub style: a dim line-number
 * gutter, and for diffs, green `+` additions and red `-` deletions.
 */
function codeBlockBody(
  code: string[],
  lang: string,
  theme: Theme,
  width: number,
): React.ReactNode[] {
  const body: React.ReactNode[] = [];
  const numW = Math.max(2, String(code.length + 1).length);
  const gutterW = numW + 3; // "NN │ "
  const innerW = Math.max(8, width - 2 - gutterW - 1);
  const diff = looksLikeDiff(lang, code);
  let key = 0;
  const gutter = (label: string) => <Text dimColor>{label.padStart(numW)} │ </Text>;

  if (diff) {
    let oldLn = 1;
    let newLn = 1;
    for (const c of code) {
      const hh = c.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (hh) {
        oldLn = Number(hh[1]);
        newLn = Number(hh[2]);
        body.push(
          <Text key={key++} color={theme.note}>
            {' '.repeat(numW)} │ {c}
          </Text>,
        );
        continue;
      }
      const isAdd = c.startsWith('+') && !c.startsWith('+++');
      const isDel = c.startsWith('-') && !c.startsWith('---');
      const sign = isAdd ? '+' : isDel ? '-' : ' ';
      const text = isAdd || isDel || c.startsWith(' ') ? c.slice(1) : c;
      const num = isAdd ? newLn++ : isDel ? oldLn++ : (oldLn++, newLn++);
      const color = isAdd ? DIFF_ADD : isDel ? DIFF_DEL : undefined;
      const bg = isAdd ? DIFF_ADD_BG : isDel ? DIFF_DEL_BG : undefined;
      hardWrap(text, innerW).forEach((seg, si) => {
        body.push(
          <Text key={key++}>
            {gutter(si === 0 ? String(num) : '')}
            <Text color={color} backgroundColor={bg}>
              {sign}
              {seg.padEnd(innerW)}
            </Text>
          </Text>,
        );
      });
    }
  } else {
    let n = 1;
    for (const c of code) {
      hardWrap(c, innerW).forEach((seg, si) => {
        body.push(
          <Text key={key++}>
            {gutter(si === 0 ? String(n) : '')}
            {highlight(seg, lang).map((sp, idx) => (
              <Text key={idx} color={sp.color}>
                {sp.text}
              </Text>
            ))}
          </Text>,
        );
      });
      n += 1;
    }
  }
  return body;
}

/** Markdown content → wrapped styled lines, with a ◆ marker on the first line. */
export function assistantLines(
  content: string,
  theme: Theme,
  width: number,
  keyBase: string,
): React.ReactNode[] {
  const lines: React.ReactNode[] = [];
  let first = true;
  const marker = () =>
    first ? (
      <Text color={theme.assistant} bold>
        {'◆ '}
      </Text>
    ) : (
      <Text>{'  '}</Text>
    );
  const push = (body: React.ReactNode) => {
    lines.push(
      <Text key={`${keyBase}-a-${lines.length}`}>
        {marker()}
        {body}
      </Text>,
    );
    first = false;
  };

  const raw = content.split('\n');
  let i = 0;
  while (i < raw.length) {
    const line = raw[i]!;

    // Fenced code block → line-numbered gutter (GitHub diff colors if a diff).
    if (line.trim().startsWith('```')) {
      const lang = line.trim().slice(3).trim();
      const code: string[] = [];
      i += 1;
      while (i < raw.length && !raw[i]!.trim().startsWith('```')) {
        code.push(raw[i]!);
        i += 1;
      }
      i += 1; // skip the closing fence

      if (lang) push(<Text dimColor>{lang}</Text>);
      for (const node of codeBlockBody(code, lang, theme, width)) push(node);
      continue;
    }

    // Non-code line: heading, bullet, or normal text.
    let color: string | undefined;
    let inline = true;
    let text = line;
    const h = line.match(/^(#{1,6})\s+(.*)/);
    const b = line.match(/^(\s*)[-*]\s+(.*)/);
    if (h) {
      text = h[2]!;
      color = theme.assistant;
      inline = false;
    } else if (b) {
      text = `${b[1]}• ${b[2]}`;
    }
    for (const ln of wrap(text, width - 2)) {
      push(inline ? renderInline(ln, theme) : <Text color={color}>{ln}</Text>);
    }
    i += 1;
  }
  return lines;
}
