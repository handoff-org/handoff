import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshHome } from './helpers.js';

// zotero.ts pulls in modules that read homedir() at load time (project, runner),
// so set up an isolated HOME before importing.
freshHome();

const {
  parseZoteroItems,
  parseChildren,
  buildNoteHtml,
  buildAnnotationPayload,
  computeSortIndex,
  parsePassages,
  bestSearchFragment,
} = await import('../src/research/zotero.js');

// ── parseZoteroItems ─────────────────────────────────────────────────────────

test('parseZoteroItems maps key/title/creators/year and drops keyless rows', () => {
  const items = parseZoteroItems([
    {
      key: 'ABC123',
      data: {
        title: 'Attention Is All You Need',
        itemType: 'journalArticle',
        date: '2017-06-12',
        creators: [
          { firstName: 'Ashish', lastName: 'Vaswani' },
          { lastName: 'Shazeer' },
          { name: 'Google Brain' },
          { lastName: 'Extra' },
        ],
      },
    },
    { data: { title: 'no key — dropped' } },
  ]);
  assert.equal(items.length, 1);
  assert.deepEqual(items[0], {
    key: 'ABC123',
    title: 'Attention Is All You Need',
    creators: 'Vaswani, Shazeer, Google Brain', // capped at 3
    itemType: 'journalArticle',
    year: '2017',
  });
});

test('parseZoteroItems tolerates junk input', () => {
  assert.deepEqual(parseZoteroItems(null), []);
  assert.deepEqual(parseZoteroItems({}), []);
});

// ── parseChildren ────────────────────────────────────────────────────────────

test('parseChildren splits notes, annotations, and the PDF attachment key', () => {
  const children = parseChildren([
    { key: 'N1', data: { itemType: 'note', note: '<p>a <b>bold</b> note</p>' } },
    {
      key: 'A1',
      data: {
        itemType: 'annotation',
        annotationType: 'highlight',
        annotationText: 'key result',
        annotationComment: 'matters because X',
      },
    },
    { key: 'P1', data: { itemType: 'attachment', contentType: 'application/pdf' } },
    { key: 'P2', data: { itemType: 'attachment', contentType: 'text/html' } },
  ]);
  assert.equal(children.notes.length, 1);
  assert.equal(children.notes[0]!.text, 'a bold note'); // HTML stripped
  assert.equal(children.annotations.length, 1);
  assert.equal(children.annotations[0]!.comment, 'matters because X');
  assert.equal(children.pdfAttachmentKey, 'P1'); // first PDF wins, non-PDF ignored
});

// ── buildNoteHtml ──────────────────────────────────────────────────────────

test('buildNoteHtml renders sections and escapes HTML', () => {
  const html = buildNoteHtml({
    title: 'Prep: Transformers',
    summary: 'Introduces self-attention.',
    passages: [{ quote: 'scaled dot-product <attention>', comment: 'core mechanism' }],
    related: ['BERT (Devlin 2019)'],
  });
  assert.match(html, /<h1>Prep: Transformers<\/h1>/);
  assert.match(html, /Introduces self-attention\./);
  assert.match(html, /<h2>Key passages<\/h2>/);
  assert.match(html, /&lt;attention&gt;/); // escaped
  assert.match(html, /core mechanism/);
  assert.match(html, /<h2>Related work<\/h2>/);
  assert.match(html, /Added by handoff/);
});

// ── parsePassages ────────────────────────────────────────────────────────────

test('parsePassages splits "quote :: comment" and tolerates missing comment', () => {
  assert.deepEqual(parsePassages(['a quote :: why it matters', 'lonely quote', '  ::  ', '']), [
    { quote: 'a quote', comment: 'why it matters' },
    { quote: 'lonely quote', comment: '' },
  ]);
  assert.deepEqual(parsePassages(undefined), []);
});

test('bestSearchFragment picks the longest verbatim span from an elided quote', () => {
  // The exact failure from a real trial: an ellipsis-joined quote can't be located,
  // but the longest contiguous fragment can.
  assert.equal(
    bestSearchFragment(
      '"Large Language Models (LLMs) ... significant challenges stemming from their extensive size and computational requirements."',
    ),
    'significant challenges stemming from their extensive size and computational requirements.',
  );
  // Unicode ellipsis + surrounding quotes stripped.
  assert.equal(
    bestSearchFragment('“short” … “a much longer contiguous phrase here”'),
    'a much longer contiguous phrase here',
  );
  // No ellipsis → the whole (unquoted) phrase.
  assert.equal(bestSearchFragment('"one clean phrase"'), 'one clean phrase');
});

// ── computeSortIndex / buildAnnotationPayload ───────────────────────────────

test('computeSortIndex pads page and top into the Zotero format', () => {
  assert.equal(computeSortIndex(2, 431.7), '00002|000000|00431');
  assert.equal(computeSortIndex(0, 0), '00000|000000|00000');
});

test('buildAnnotationPayload flips PyMuPDF top-left rects to Zotero bottom-left', () => {
  const payload = buildAnnotationPayload({
    attachmentKey: 'P1',
    text: 'key result',
    comment: 'matters',
    pageIndex: 3,
    pageHeight: 792,
    rects: [[10, 20, 100, 32]],
  }) as Record<string, unknown>;
  assert.equal(payload['itemType'], 'annotation');
  assert.equal(payload['parentItem'], 'P1');
  assert.equal(payload['annotationType'], 'highlight');
  assert.equal(payload['annotationText'], 'key result');
  assert.equal(payload['annotationColor'], '#ffd400'); // default
  assert.equal(payload['annotationPageLabel'], '4'); // 1-based
  // Y flipped about pageHeight 792: [10, 792-32, 100, 792-20] = [10, 760, 100, 772].
  assert.deepEqual(JSON.parse(String(payload['annotationPosition'])), {
    pageIndex: 3,
    rects: [[10, 760, 100, 772]],
  });
  // sortIndex still keys off the top-left top edge (20), for top-to-bottom order.
  assert.equal(payload['annotationSortIndex'], '00003|000000|00020');
});

test('buildAnnotationPayload leaves rects unflipped when pageHeight is absent', () => {
  const payload = buildAnnotationPayload({
    attachmentKey: 'P1',
    text: 't',
    pageIndex: 0,
    rects: [[1, 2, 3, 4]],
  }) as Record<string, unknown>;
  assert.deepEqual(JSON.parse(String(payload['annotationPosition'])), {
    pageIndex: 0,
    rects: [[1, 2, 3, 4]],
  });
});
