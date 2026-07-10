import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  htmlToText,
  decodeEntities,
  truncate,
  unwrapDdgUrl,
  parseDuckDuckGoHtml,
  formatSearchResults,
} from '../src/tools/web.js';

// ── htmlToText ──────────────────────────────────────────────────────────────

test('htmlToText strips script and style blocks entirely', () => {
  const html =
    '<html><head><title>x</title></head><body>' +
    '<script>alert("nope")</script><style>.a{color:red}</style>' +
    '<p>Hello world</p></body></html>';
  const text = htmlToText(html);
  assert.ok(text.includes('Hello world'));
  assert.ok(!text.includes('alert'), 'script contents must be removed');
  assert.ok(!text.includes('color:red'), 'style contents must be removed');
  assert.ok(!text.includes('<'), 'no tags should remain');
});

test('htmlToText turns block tags and <br> into newlines', () => {
  const text = htmlToText('<p>one</p><p>two</p><div>three<br>four</div>');
  const lines = text.split('\n').filter(Boolean);
  assert.deepEqual(lines, ['one', 'two', 'three', 'four']);
});

test('htmlToText decodes entities', () => {
  assert.equal(htmlToText('<p>a &amp; b &lt; c &gt; d</p>'), 'a & b < c > d');
  // numeric (decimal + hex) entities, including accented chars without a name map
  assert.equal(htmlToText("<p>&#39;x&#39; &#x2014; caf&#233;</p>"), "'x' — café");
});

test('htmlToText collapses runaway whitespace and blank lines', () => {
  const text = htmlToText('<p>a</p>\n\n\n\n<p>b</p>   \t  <span>  c  </span>');
  assert.ok(!/\n{3,}/.test(text), 'no 3+ consecutive newlines');
  assert.ok(!/  /.test(text), 'no double spaces');
});

test('decodeEntities handles numeric decimal and hex', () => {
  assert.equal(decodeEntities('&#65;&#66;&#67;'), 'ABC');
  assert.equal(decodeEntities('&#x41;&#x42;'), 'AB');
  assert.equal(decodeEntities('&unknownentity;'), '&unknownentity;');
});

// ── truncate ──────────────────────────────────────────────────────────────

test('truncate leaves short text alone and clips long text with a notice', () => {
  assert.equal(truncate('short', 100), 'short');
  const out = truncate('x'.repeat(50), 10);
  assert.ok(out.startsWith('x'.repeat(10)));
  assert.ok(out.includes('truncated 40 more chars'));
});

test('truncate with non-positive max returns text unchanged', () => {
  assert.equal(truncate('abc', 0), 'abc');
});

// ── unwrapDdgUrl ──────────────────────────────────────────────────────────

test('unwrapDdgUrl extracts the uddg target', () => {
  const href = '//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpage%3Fa%3D1&amp;rut=abc';
  assert.equal(unwrapDdgUrl(href), 'https://example.com/page?a=1');
});

test('unwrapDdgUrl passes through a direct absolute URL', () => {
  assert.equal(unwrapDdgUrl('https://example.org/x'), 'https://example.org/x');
});

test('unwrapDdgUrl adds scheme to protocol-relative URLs', () => {
  assert.equal(unwrapDdgUrl('//example.org/x'), 'https://example.org/x');
});

// ── parseDuckDuckGoHtml ────────────────────────────────────────────────────

const DDG_FIXTURE = `
<div class="result results_links">
  <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fen.wikipedia.org%2FEntropy&amp;rut=1">Entropy - Wikipedia</a>
  <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fen.wikipedia.org%2FEntropy">In thermodynamics, <b>entropy</b> is a measure of disorder.</a>
</div>
<div class="result results_links">
  <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpaper&amp;rut=2">A paper on entropy</a>
  <a class="result__snippet" href="#">We study <b>entropy</b> in open systems.</a>
</div>
`;

test('parseDuckDuckGoHtml extracts titles, unwrapped URLs, and snippets', () => {
  const results = parseDuckDuckGoHtml(DDG_FIXTURE, 5);
  assert.equal(results.length, 2);
  assert.equal(results[0]!.title, 'Entropy - Wikipedia');
  assert.equal(results[0]!.url, 'https://en.wikipedia.org/Entropy');
  assert.ok(results[0]!.snippet.includes('measure of disorder'));
  assert.ok(!results[0]!.snippet.includes('<b>'), 'snippet HTML stripped');
  assert.equal(results[1]!.url, 'https://example.com/paper');
});

test('parseDuckDuckGoHtml respects the limit', () => {
  assert.equal(parseDuckDuckGoHtml(DDG_FIXTURE, 1).length, 1);
});

test('parseDuckDuckGoHtml returns [] on non-result HTML', () => {
  assert.deepEqual(parseDuckDuckGoHtml('<html><body>nothing here</body></html>', 5), []);
});

// ── formatSearchResults ────────────────────────────────────────────────────

test('formatSearchResults renders a numbered list', () => {
  const out = formatSearchResults('entropy', [
    { title: 'T1', url: 'https://a.com', snippet: 's1' },
    { title: 'T2', url: 'https://b.com', snippet: '' },
  ]);
  assert.ok(out.includes('[1] T1'));
  assert.ok(out.includes('https://a.com'));
  assert.ok(out.includes('s1'));
  assert.ok(out.includes('[2] T2'));
});

test('formatSearchResults reports no results clearly', () => {
  const out = formatSearchResults('zzz', []);
  assert.ok(out.toLowerCase().includes('no results'));
});
