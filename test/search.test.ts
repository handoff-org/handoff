import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { globToRegExp, globFiles, grepFiles, walkFiles } from '../src/tools/search.js';

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'handoff-search-'));
  writeFileSync(join(root, 'a.py'), 'import numpy\nprint("hello")\n');
  writeFileSync(join(root, 'b.txt'), 'nothing here\n');
  mkdirSync(join(root, 'sub'));
  writeFileSync(join(root, 'sub', 'c.py'), 'import numpy as np\n# TODO: fix\n');
  mkdirSync(join(root, 'node_modules'));
  writeFileSync(join(root, 'node_modules', 'skip.py'), 'import numpy\n');
  return root;
}

test('globToRegExp: ** spans directories, * stays within a segment', () => {
  assert.equal(globToRegExp('**/*.py').test('a.py'), true);
  assert.equal(globToRegExp('**/*.py').test('sub/c.py'), true);
  assert.equal(globToRegExp('*.py').test('a.py'), true);
  assert.equal(globToRegExp('*.py').test('sub/c.py'), false);
  assert.equal(globToRegExp('**/*.py').test('a.txt'), false);
});

test('walkFiles skips node_modules', () => {
  const files = [...walkFiles(fixture())];
  assert.ok(files.some((f) => f.endsWith('c.py')));
  assert.ok(!files.some((f) => f.includes('node_modules')));
});

test('globFiles matches recursively and sorts', () => {
  const { files } = globFiles(fixture(), '**/*.py');
  assert.deepEqual(files, ['a.py', 'sub/c.py']);
});

test('grepFiles finds matches with file:line, case-insensitive by default', () => {
  const { matches } = grepFiles(fixture(), 'IMPORT NUMPY');
  const hits = matches.map((m) => m.file).sort();
  assert.deepEqual(hits, ['a.py', 'sub/c.py']);
  assert.equal(matches[0]!.line, 1);
});

test('grepFiles honors a glob filter and skips binaries/large files', () => {
  const root = fixture();
  writeFileSync(join(root, 'bin.py'), Buffer.from([0x69, 0x00, 0x6e])); // NUL → binary
  const { matches } = grepFiles(root, 'TODO', { glob: '**/*.py' });
  assert.equal(matches.length, 1);
  assert.match(matches[0]!.file, /c\.py$/);
});

test('grepFiles falls back to a literal match on an invalid regex (no throw)', () => {
  // '[zzz' is an invalid regex (unterminated class); the literal string isn't in
  // the fixtures, so we get 0 matches — and, crucially, no exception.
  const { matches } = grepFiles(fixture(), '[zzz', {});
  assert.equal(matches.length, 0);
  // A literal paren, on the other hand, is present and found via the fallback.
  assert.ok(grepFiles(fixture(), '(', {}).matches.length >= 1);
});
