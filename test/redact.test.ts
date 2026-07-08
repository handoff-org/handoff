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

test('masks bare OpenAI keys', () => {
  const out = redactSecrets('key sk-abcABC123defDEF456ghiGHI789 works');
  assert.ok(!out.includes('sk-abcABC123'), `leaked: ${out}`);
  assert.match(out, /key ••• works/);
  // sk-proj- form
  assert.ok(!redactSecrets('sk-proj-abcdefABCDEF0123456789xyz').includes('proj-abcdef'));
});

test('masks bare GitHub tokens', () => {
  for (const p of ['ghp', 'gho', 'ghs', 'ghr', 'ghu']) {
    const tok = `${p}_${'A1b2C3d4E5f6G7h8I9j0'}`; // 20 chars after prefix
    const out = redactSecrets(`token ${tok} here`);
    assert.ok(!out.includes(tok), `leaked ${p}: ${out}`);
  }
});

test('masks AWS access-key ids', () => {
  const out = redactSecrets('aws AKIAIOSFODNN7EXAMPLE creds');
  assert.ok(!out.includes('AKIAIOSFODNN7EXAMPLE'), `leaked: ${out}`);
});

test('new patterns do not touch ordinary prose', () => {
  const s = 'The task force met to discuss the project skeleton and the AKIA prefix rule.';
  assert.equal(redactSecrets(s), s);
});
