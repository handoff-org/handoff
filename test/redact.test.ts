import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redactSecrets } from '../src/util/redact.js';

test('masks a JSON token value', () => {
  const out = redactSecrets('{"token":"ghp_secret123"}');
  assert.equal(out, '{"token":"•••"}');
});

test('masks password / secret / api_key keys, case-insensitively', () => {
  assert.match(redactSecrets('{"Password":"hunter2"}'), /"Password":"•••"/);
  assert.match(redactSecrets('{"api_key":"abc"}'), /"api_key":"•••"/);
  assert.match(redactSecrets('{"API-KEY":"abc"}'), /"API-KEY":"•••"/);
});

test('leaves non-secret values intact', () => {
  const s = '{"path":"paper/main.tex","content":"hello"}';
  assert.equal(redactSecrets(s), s);
});

test('masks a token embedded in a git URL', () => {
  assert.equal(
    redactSecrets('https://git:tok_SECRET@git.overleaf.com/abc'),
    'https://•••@git.overleaf.com/abc',
  );
  assert.equal(redactSecrets('cloning //user@host'), 'cloning //•••@host');
});

test('masks Authorization / Bearer headers', () => {
  const bearer = redactSecrets('Authorization: Bearer hf_abcDEF12345');
  assert.ok(!bearer.includes('hf_abcDEF12345'), `token leaked: ${bearer}`);
  assert.match(bearer, /•••/);
  assert.match(redactSecrets('authorization="sk-xyz"'), /authorization="•••/);
});

test('masks a bare HuggingFace token', () => {
  assert.equal(redactSecrets('using hf_abcdEFGH12345 now'), 'using ••• now');
});

test('does not mangle ordinary prose that merely mentions tokens', () => {
  const s = 'The token bucket algorithm limits requests per second.';
  assert.equal(redactSecrets(s), s);
});
