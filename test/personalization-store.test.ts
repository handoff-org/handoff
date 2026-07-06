import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import { freshHome } from './helpers.js';

freshHome();
const { loadProfile, saveProfile, resetProfile, exportProfile, PROFILE_PATH } = await import(
  '../src/personalization/store.js'
);
const { PROFILE_VERSION } = await import('../src/personalization/profile.js');

function bakCount(): number {
  try {
    return readdirSync(dirname(PROFILE_PATH)).filter((f) => f.startsWith('profile.json.') && f.endsWith('.bak')).length;
  } catch {
    return 0;
  }
}

test('loadProfile returns a valid default when no file exists', () => {
  const p = loadProfile();
  assert.equal(p.version, PROFILE_VERSION);
  assert.deepEqual(p.explicitPreferences, []);
  assert.equal(existsSync(PROFILE_PATH), false, 'default is not written until something is learned');
});

test('saveProfile then loadProfile round-trips', async () => {
  const p = loadProfile();
  p.explicitPreferences.push({
    key: 'verbosity',
    value: 'prefers concise answers',
    source: 'explicit',
    confidence: 0.9,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    evidenceCount: 1,
  });
  await saveProfile(p);
  assert.equal(existsSync(PROFILE_PATH), true);
  const loaded = loadProfile();
  assert.equal(loaded.explicitPreferences.length, 1);
  assert.equal(loaded.explicitPreferences[0]!.key, 'verbosity');
});

test('corrupt JSON is backed up and replaced with a fresh default', () => {
  writeFileSync(PROFILE_PATH, '{ not valid json', 'utf-8');
  const before = bakCount();
  const p = loadProfile();
  assert.equal(p.version, PROFILE_VERSION);
  assert.deepEqual(p.explicitPreferences, []);
  assert.equal(bakCount(), before + 1, 'a .bak backup should have been created');
});

test('a wrong-version object is treated as unsalvageable → fresh default', () => {
  writeFileSync(PROFILE_PATH, JSON.stringify({ version: 999, junk: true }), 'utf-8');
  const p = loadProfile();
  assert.equal(p.version, PROFILE_VERSION);
});

test('resetProfile backs up and returns a fresh default', async () => {
  const p = loadProfile();
  p.ignoredSuggestions.push('x');
  await saveProfile(p);
  const before = bakCount();
  const fresh = resetProfile();
  assert.deepEqual(fresh.ignoredSuggestions, []);
  assert.equal(existsSync(PROFILE_PATH), false, 'the live file is moved aside on reset');
  assert.equal(bakCount(), before + 1);
});

test('exportProfile writes a copy and returns its path', () => {
  const dest = exportProfile(loadProfile());
  assert.ok(dest && existsSync(dest), 'export should create a file');
});
