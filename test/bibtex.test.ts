import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  citeKey,
  disambiguateKey,
  toBibEntry,
  parseBibKeys,
  mergeBibEntry,
  findExistingKey,
} from '../src/research/bibtex.js';
import type { Paper } from '../src/research/openalex.js';

function paper(over: Partial<Paper>): Paper {
  return {
    id: 'W1',
    title: 'A Title',
    year: 2020,
    venue: 'NeurIPS',
    citations: 0,
    doi: '',
    oaUrl: '',
    authors: ['Jane Doe'],
    abstract: '',
    ...over,
  };
}

test('citeKey: firstAuthorFamily + year + first significant title word', () => {
  assert.equal(
    citeKey({ authors: ['Ashish Vaswani'], year: 2017, title: 'Attention Is All You Need' }),
    'vaswani2017attention',
  );
});

test('citeKey: skips leading stopwords for the title word', () => {
  assert.equal(
    citeKey({ authors: ['John Smith'], year: 2020, title: 'The Transformer Architecture' }),
    'smith2020transformer',
  );
});

test('citeKey: folds diacritics to ASCII', () => {
  assert.equal(
    citeKey({ authors: ['Émile Zöllner'], year: 2019, title: 'Über Netzwerke' }),
    'zollner2019uber',
  );
});

test('citeKey: degrades when author/year are missing', () => {
  const k = citeKey({ authors: [], year: 0, title: 'Datasets' });
  assert.equal(k, 'anonnddatasets');
});

test('toBibEntry: @article with venue + doi, brace-protected title, no url', () => {
  const e = toBibEntry(paper({ doi: '10.1/x', venue: 'JMLR', title: 'Deep Nets' }), 'k1');
  assert.match(e, /^@article\{k1,/);
  assert.match(e, /title = \{\{Deep Nets\}\}/);
  assert.match(e, /journal = \{JMLR\}/);
  assert.match(e, /doi = \{10\.1\/x\}/);
  assert.doesNotMatch(e, /url =/);
});

test('toBibEntry: escapes LaTeX specials so a stray & cannot break compilation', () => {
  const e = toBibEntry(paper({ title: 'Cats & Dogs' }), 'k2');
  assert.match(e, /title = \{\{Cats \\& Dogs\}\}/);
});

test('toBibEntry: @misc when there is no venue', () => {
  const e = toBibEntry(paper({ venue: '', doi: '' }), 'k3');
  assert.match(e, /^@misc\{k3,/);
});

test('toBibEntry: arXiv preprint gets eprint + archivePrefix', () => {
  const e = toBibEntry(
    paper({
      id: 'arxiv:2301.07041',
      venue: 'arXiv',
      doi: '',
      oaUrl: 'https://arxiv.org/abs/2301.07041',
    }),
    'k4',
  );
  assert.match(e, /^@misc\{k4,/);
  assert.match(e, /eprint = \{2301\.07041\}/);
  assert.match(e, /archivePrefix = \{arXiv\}/);
});

test('parseBibKeys: extracts every entry key', () => {
  const bib =
    '@article{smith2020transformer,\n title={x}\n}\n\n@misc{doe2019data,\n title={y}\n}\n';
  assert.deepEqual([...parseBibKeys(bib)].sort(), ['doe2019data', 'smith2020transformer']);
});

test('mergeBibEntry: appends when absent, is a no-op when present', () => {
  const entry = '@article{k1,\n  title = {{X}},\n}\n';
  const first = mergeBibEntry('% seed\n', 'k1', entry);
  assert.equal(first.added, true);
  assert.match(first.text, /@article\{k1,/);
  assert.match(first.text, /% seed/); // preserves prior content

  const second = mergeBibEntry(first.text, 'k1', entry);
  assert.equal(second.added, false);
  assert.equal(second.text, first.text); // idempotent
});

test('disambiguateKey: appends a, b, … on collision', () => {
  assert.equal(disambiguateKey('smith2020x', new Set()), 'smith2020x');
  assert.equal(disambiguateKey('smith2020x', new Set(['smith2020x'])), 'smith2020xa');
  assert.equal(
    disambiguateKey('smith2020x', new Set(['smith2020x', 'smith2020xa'])),
    'smith2020xb',
  );
});

test('findExistingKey: matches by doi, eprint, or exact title; null when absent', () => {
  const byDoi = toBibEntry(paper({ doi: '10.5/y', title: 'Alpha' }), 'ka');
  assert.equal(findExistingKey(byDoi, paper({ doi: '10.5/y', title: 'Different' })), 'ka');

  const byArxiv = toBibEntry(paper({ id: 'arxiv:2401.00001', venue: 'arXiv', doi: '' }), 'kb');
  assert.equal(
    findExistingKey(byArxiv, paper({ id: 'arxiv:2401.00001', venue: 'arXiv', doi: '' })),
    'kb',
  );

  const byTitle = toBibEntry(paper({ doi: '', venue: '', title: 'Unique Title' }), 'kc');
  assert.equal(
    findExistingKey(byTitle, paper({ doi: '', venue: '', title: 'Unique Title' })),
    'kc',
  );

  assert.equal(findExistingKey(byDoi, paper({ doi: '10.9/z', title: 'Nope' })), null);
});
