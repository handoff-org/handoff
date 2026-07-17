import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizePreference } from '../src/personalization/redaction.js';

test('accepts a plain short preference', () => {
  const r = sanitizePreference('prefers the NeurIPS template');
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.value, 'prefers the NeurIPS template');
});

test('rejects secrets', () => {
  assert.equal(sanitizePreference('my token=hf_abcdef012345678').ok, false);
  assert.equal(sanitizePreference('api_key: "sk-supersecretvalue"').ok, false);
});

test('rejects code fences', () => {
  assert.equal(sanitizePreference('use this ```const x = 1;```').ok, false);
});

test('rejects overly long passages', () => {
  assert.equal(sanitizePreference('word '.repeat(60)).ok, false);
  assert.equal(sanitizePreference('x'.repeat(250)).ok, false);
});

test('rejects token-bearing URLs', () => {
  assert.equal(sanitizePreference('sync https://api.example.com/repo?token=abc123').ok, false);
  assert.equal(sanitizePreference('clone https://user:pw@host/repo').ok, false);
});

test('strips emails but keeps the preference', () => {
  const r = sanitizePreference('cc me at alice@example.com on updates');
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.doesNotMatch(r.value, /alice@example\.com/);
    assert.match(r.value, /‹email›/);
  }
});

test('rejects empty input', () => {
  assert.equal(sanitizePreference('   ').ok, false);
});
