import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshHome } from './helpers.js';

// openreview.ts imports config/schema (which reads homedir() at load), so set up
// an isolated HOME before importing.
freshHome();

const {
  fieldValue,
  flattenContent,
  noteInvitations,
  classifyReply,
  parseSubmissions,
  parseReplies,
  formatReplies,
} = await import('../src/research/openreview.js');

// ── fieldValue / flattenContent (v2 nesting) ─────────────────────────────────

test('fieldValue reads v2 {value} nesting, v1 bare values, and arrays', () => {
  assert.equal(fieldValue({ title: { value: 'A Great Paper' } }, 'title'), 'A Great Paper');
  assert.equal(fieldValue({ title: 'legacy v1 title' }, 'title'), 'legacy v1 title');
  assert.equal(fieldValue({ authors: { value: ['Ada', 'Alan'] } }, 'authors'), 'Ada, Alan');
  assert.equal(fieldValue({}, 'missing'), '');
  assert.equal(fieldValue(undefined, 'x'), '');
});

test('flattenContent keeps only non-empty fields as strings', () => {
  const flat = flattenContent({
    title: { value: 'T' },
    rating: { value: 7 },
    empty: { value: '' },
  });
  assert.deepEqual(flat, { title: 'T', rating: '7' });
});

// ── noteInvitations / classifyReply ──────────────────────────────────────────

test('noteInvitations prefers v2 array, falls back to v1 single', () => {
  assert.deepEqual(noteInvitations({ invitations: ['V/-/Official_Review'] }), [
    'V/-/Official_Review',
  ]);
  assert.deepEqual(noteInvitations({ invitation: 'V/-/Decision' }), ['V/-/Decision']);
  assert.deepEqual(noteInvitations({}), []);
});

test('classifyReply maps invitation suffixes to kinds', () => {
  assert.equal(classifyReply({ invitations: ['ICLR/-/Paper12/Official_Review'] }), 'review');
  assert.equal(classifyReply({ invitations: ['ICLR/-/Paper12/Meta_Review'] }), 'meta-review');
  assert.equal(classifyReply({ invitations: ['ICLR/-/Paper12/Decision'] }), 'decision');
  assert.equal(classifyReply({ invitations: ['ICLR/-/Paper12/Official_Comment'] }), 'comment');
  assert.equal(classifyReply({ invitations: ['ICLR/-/Paper12/Rebuttal'] }), 'rebuttal');
  assert.equal(classifyReply({ invitations: ['ICLR/-/Paper12/Revision'] }), 'other');
});

// ── parseSubmissions ─────────────────────────────────────────────────────────

test('parseSubmissions extracts forum, title, venue, number', () => {
  const subs = parseSubmissions({
    notes: [
      {
        id: 'aBc123',
        forum: 'aBc123',
        number: 42,
        content: { title: { value: 'My Paper' }, venue: { value: 'ICLR 2026' } },
      },
      { content: { title: { value: 'no id — dropped' } } },
    ],
  });
  assert.equal(subs.length, 1);
  assert.deepEqual(subs[0], {
    id: 'aBc123',
    forum: 'aBc123',
    number: 42,
    title: 'My Paper',
    venue: 'ICLR 2026',
  });
});

// ── parseReplies ─────────────────────────────────────────────────────────────

test('parseReplies drops the submission note and classifies the rest', () => {
  const forum = 'F1';
  const replies = parseReplies(
    {
      notes: [
        { id: 'F1', forum: 'F1', content: { title: { value: 'submission itself' } } },
        {
          id: 'R1',
          forum: 'F1',
          invitations: ['V/-/Official_Review'],
          signatures: ['V/Paper1/Reviewer_x'],
          content: { rating: { value: 6 }, review: { value: 'solid work' } },
        },
        {
          id: 'D1',
          forum: 'F1',
          invitations: ['V/-/Decision'],
          signatures: ['V/Program_Chairs'],
          content: { decision: { value: 'Accept' } },
        },
        { id: 'X1', forum: 'F1', invitations: ['V/-/Revision'], content: {} },
      ],
    },
    forum,
  );
  // submission (F1) excluded; Revision (X1) classified 'other' and dropped.
  assert.equal(replies.length, 2);
  const review = replies.find((r) => r.kind === 'review');
  assert.ok(review);
  assert.equal(review!.signatures, 'V/Paper1/Reviewer_x');
  assert.equal(review!.content['rating'], '6');
  assert.ok(replies.some((r) => r.kind === 'decision'));
});

// ── formatReplies ─────────────────────────────────────────────────────────────

test('formatReplies renders a header and groups by kind in order', () => {
  const out = formatReplies(
    [
      { kind: 'review', signatures: 'Reviewer_x', content: { rating: '6', review: 'solid' } },
      { kind: 'decision', signatures: 'Chairs', content: { decision: 'Accept' } },
    ],
    { id: 'F1', forum: 'F1', number: 42, title: 'My Paper', venue: 'ICLR 2026' },
  );
  assert.match(out, /# My Paper \(#42\) — ICLR 2026/);
  // Decision is ordered before Review.
  assert.ok(out.indexOf('## Decision') < out.indexOf('## Review'));
  assert.match(out, /\*\*rating\*\*: 6/);
});

test('formatReplies reports emptiness clearly', () => {
  assert.match(formatReplies([]), /No reviews, comments, or decisions/);
});
