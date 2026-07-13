import type { ToolRegistry } from '../registry.js';
import { safeFetch } from '../ssrf.js';
import { htmlToText, truncate, parseDuckDuckGoHtml, formatSearchResults } from '../web.js';

// A browser-like UA: default fetch UA is often blocked by search endpoints and
// some sites; this keeps web_fetch/web_search working against real pages.
const WEB_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

/**
 * Web tools: fetch a page as readable text, and DuckDuckGo web search. Both are
 * `sensitive: true`; web_fetch goes through safeFetch (SSRF guard on every
 * redirect hop) so a page can't redirect to localhost / a metadata endpoint.
 */
export function registerWebTools(registry: ToolRegistry): void {
  registry.register({
    name: 'web_fetch',
    description:
      'Fetch a web page and return its readable text (HTML is stripped of markup, ' +
      'scripts, and navigation). Use for reading articles, docs, or any URL. ' +
      'For PDFs use read_pdf instead. Output is capped; raise max_chars to read more.',
    sensitive: true,
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to fetch (http/https)' },
        max_chars: {
          type: 'string',
          description: 'Truncate output to this many characters (default 12000)',
        },
      },
      required: ['url'],
    },
    async execute({ url, max_chars }) {
      const limit = max_chars ? Number(max_chars) : 12_000;
      // safeFetch re-checks the SSRF guard on every redirect hop, so a page can't
      // redirect to localhost / a metadata endpoint and slip past the initial check.
      let res: Response;
      try {
        res = await safeFetch(String(url), {
          headers: { 'User-Agent': WEB_UA, Accept: 'text/html,application/xhtml+xml,*/*' },
        });
      } catch (err) {
        return err instanceof Error ? err.message : String(err);
      }
      if (!res.ok) return `HTTP ${res.status}: ${res.statusText}`;
      const ct = (res.headers.get('content-type') ?? '').toLowerCase();
      const body = await res.text();
      if (ct.includes('html') || /^\s*<(!doctype|html)\b/i.test(body)) {
        return truncate(htmlToText(body), limit);
      }
      if (ct.includes('json') || ct.includes('xml') || ct.startsWith('text/') || !ct) {
        return truncate(body, limit);
      }
      return `(${ct} — ${body.length} bytes; not text. For PDFs use read_pdf.)`;
    },
  });

  registry.register({
    name: 'web_search',
    description:
      'Search the web and return the top results (title, URL, snippet). Use to find ' +
      'sources, papers, docs, or facts, then web_fetch a result URL to read it. ' +
      'No API key required (DuckDuckGo).',
    sensitive: true,
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        max_results: {
          type: 'string',
          description: 'How many results to return (default 5, max 10)',
        },
      },
      required: ['query'],
    },
    async execute({ query, max_results }) {
      const q = String(query ?? '').trim();
      if (!q) return 'Refused: empty search query.';
      const n = Math.min(Math.max(Number(max_results) || 5, 1), 10);
      const endpoint = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`;
      let res: Response;
      try {
        res = await fetch(endpoint, {
          headers: {
            'User-Agent': WEB_UA,
            Accept: 'text/html',
            'Accept-Language': 'en-US,en;q=0.9',
          },
        });
      } catch (err) {
        return `Search failed: ${err instanceof Error ? err.message : String(err)}`;
      }
      if (!res.ok) return `Search failed: HTTP ${res.status}: ${res.statusText}`;
      const html = await res.text();
      return formatSearchResults(q, parseDuckDuckGoHtml(html, n));
    },
  });
}
