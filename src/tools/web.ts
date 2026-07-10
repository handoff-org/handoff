/**
 * Web helpers for the web_fetch / web_search tools. Kept pure and network-free so
 * they can be unit-tested with fixture strings — the tools in builtin.ts do the
 * actual fetching and call these to shape the output.
 */

// ── HTML → readable text ────────────────────────────────────────────────────

const BLOCK_TAGS_TO_NEWLINE =
  /<\/?(?:p|div|section|article|header|footer|main|aside|nav|ul|ol|li|tr|table|h[1-6]|blockquote|pre|figure|figcaption)\b[^>]*>/gi;

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  rsquo: '’',
  lsquo: '‘',
  ldquo: '“',
  rdquo: '”',
  copy: '©',
  reg: '®',
  trade: '™',
  deg: '°',
  middot: '·',
  bull: '•',
};

/** Decode the handful of HTML entities that actually show up in body text. */
export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => safeCodePoint(parseInt(dec, 10)))
    .replace(/&([a-zA-Z]+);/g, (m, name) => NAMED_ENTITIES[name] ?? NAMED_ENTITIES[name.toLowerCase()] ?? m);
}

function safeCodePoint(n: number): string {
  if (!Number.isFinite(n) || n < 0 || n > 0x10ffff) return '';
  try {
    return String.fromCodePoint(n);
  } catch {
    return '';
  }
}

/**
 * Convert an HTML document to plain, readable text. Drops scripts/styles/markup
 * that carries no reading value, turns block-level tags into line breaks, strips
 * the rest of the tags, decodes entities, and collapses runaway whitespace. This
 * is deliberately lightweight (no DOM parser) — good enough to feed a page's prose
 * to the model without the tag soup.
 */
export function htmlToText(html: string): string {
  let s = html;
  // Remove whole non-content elements (with their contents).
  s = s.replace(/<(script|style|head|noscript|svg|iframe|template|form)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ');
  // Drop comments.
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');
  // Line breaks.
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(BLOCK_TAGS_TO_NEWLINE, '\n');
  // Strip all remaining tags.
  s = s.replace(/<[^>]+>/g, ' ');
  // Entities.
  s = decodeEntities(s);
  // Whitespace cleanup: trim each line, drop trailing spaces, cap blank runs.
  s = s
    .split('\n')
    .map((line) => line.replace(/[ \t ]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return s;
}

/** Truncate to `max` chars, appending a clear notice when clipped. */
export function truncate(text: string, max: number): string {
  if (max <= 0 || text.length <= max) return text;
  return text.slice(0, max) + `\n\n… [truncated ${text.length - max} more chars]`;
}

// ── DuckDuckGo results parsing ──────────────────────────────────────────────

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

/**
 * Extract the real destination from a DuckDuckGo result href. The HTML endpoint
 * wraps targets in a redirect like `//duckduckgo.com/l/?uddg=<encoded-url>&rut=…`;
 * unwrap it. Direct hrefs (already absolute) are returned as-is.
 */
export function unwrapDdgUrl(href: string): string {
  let h = href.replace(/&amp;/g, '&').trim();
  const m = h.match(/[?&]uddg=([^&]+)/);
  if (m && m[1]) {
    try {
      return decodeURIComponent(m[1]);
    } catch {
      return m[1];
    }
  }
  if (h.startsWith('//')) h = 'https:' + h;
  return h;
}

/**
 * Parse the result list from DuckDuckGo's HTML endpoint
 * (https://html.duckduckgo.com/html/). Pairs each `result__a` anchor (title +
 * href) with the following `result__snippet`. Regex-based on purpose — the markup
 * is stable enough and this avoids a DOM dependency. Returns up to `limit` hits.
 */
export function parseDuckDuckGoHtml(html: string, limit = 5): SearchResult[] {
  const results: SearchResult[] = [];

  // Titles + links.
  const anchorRe = /<a\b[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  // Snippets, in document order.
  const snippetRe = /<a\b[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;

  const snippets: string[] = [];
  let sm: RegExpExecArray | null;
  while ((sm = snippetRe.exec(html)) !== null) {
    snippets.push(htmlToText(sm[1] ?? '').replace(/\n+/g, ' ').trim());
  }

  let am: RegExpExecArray | null;
  let i = 0;
  while ((am = anchorRe.exec(html)) !== null && results.length < limit) {
    const url = unwrapDdgUrl(am[1] ?? '');
    const title = htmlToText(am[2] ?? '').replace(/\n+/g, ' ').trim();
    if (!url || !title) {
      i++;
      continue;
    }
    results.push({ title, url, snippet: snippets[i] ?? '' });
    i++;
  }
  return results;
}

/** Render search results as a compact, model-friendly numbered list. */
export function formatSearchResults(query: string, results: SearchResult[]): string {
  if (results.length === 0) {
    return `No results for "${query}". DuckDuckGo may be rate-limiting — try again shortly or rephrase.`;
  }
  const lines = results.map((r, i) => {
    const head = `[${i + 1}] ${r.title}\n    ${r.url}`;
    return r.snippet ? `${head}\n    ${r.snippet}` : head;
  });
  return `Results for "${query}":\n\n${lines.join('\n\n')}`;
}
