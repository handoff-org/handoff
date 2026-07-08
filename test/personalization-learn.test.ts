import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectExplicitPreference,
  applyExplicit,
  recordEvent,
  confFor,
  forgetPreference,
  type PersonalizationEvent,
} from '../src/personalization/learn.js';
import { defaultProfile } from '../src/personalization/profile.js';

const NOW = '2026-07-05T12:00:00.000Z';
const fresh = () => defaultProfile(NOW);

// ── Explicit detection ─────────────────────────────────────────────────────────

test('a message with no preference trigger is not captured', () => {
  assert.equal(detectExplicitPreference('write a python script that plots accuracy'), null);
});

test('detects concise verbosity', () => {
  const d = detectExplicitPreference('from now on I prefer short answers');
  assert.equal(d?.key, 'verbosity');
});

test('detects a paper template preference', () => {
  const d = detectExplicitPreference('always use the NeurIPS format');
  assert.equal(d?.key, 'paper-template');
});

test('detects "never use cloud models"', () => {
  const d = detectExplicitPreference('never use cloud models');
  assert.equal(d?.key, 'avoid-cloud');
});

test('detects a default model and a rejected model', () => {
  assert.equal(detectExplicitPreference('use qwen3:8b by default')?.key, 'preferred-model');
  assert.equal(
    detectExplicitPreference("don't use ornith:35b, it overheats my mac")?.key,
    'rejected-model',
  );
});

test('a triggered-but-unclassified statement becomes a generic note', () => {
  const d = detectExplicitPreference('remember that I keep figures in results/figures');
  assert.ok(d && d.key.startsWith('note-'));
});

// ── Applying explicit preferences ───────────────────────────────────────────────

test('applyExplicit records the pref at 0.9 and sets the structured field', () => {
  const d = detectExplicitPreference('always use the ACL template')!;
  const p = applyExplicit(fresh(), d, 'prefers the ACL paper template', NOW);
  assert.equal(p.explicitPreferences[0]!.confidence, 0.9);
  assert.equal(p.researchStyle.preferredPaperTemplates?.value.includes('ACL'), true);
  assert.equal(p.projectDefaults.defaultPaperTemplate?.value, 'ACL');
});

test('preferring a model removes it from rejected and vice-versa', () => {
  let p = applyExplicit(
    fresh(),
    { key: 'rejected-model', phrase: 'avoid model qwen3:8b' },
    'avoid model qwen3:8b',
    NOW,
  );
  assert.deepEqual(p.modelAndPerformance.rejectedModels?.value, ['qwen3:8b']);
  p = applyExplicit(
    p,
    { key: 'preferred-model', phrase: 'prefers model qwen3:8b' },
    'prefers model qwen3:8b',
    NOW,
  );
  assert.deepEqual(p.modelAndPerformance.preferredModels?.value, ['qwen3:8b']);
  assert.deepEqual(p.modelAndPerformance.rejectedModels?.value, []);
});

test('forgetPreference removes an explicit key', () => {
  const d = detectExplicitPreference('from now on I prefer short answers')!;
  const p = applyExplicit(fresh(), d, 'prefers concise answers', NOW);
  const after = forgetPreference(p, 'verbosity');
  assert.equal(
    after.explicitPreferences.find((x) => x.key === 'verbosity'),
    undefined,
  );
});

// ── Inferred habits (thresholds) ────────────────────────────────────────────────

test('confFor: no inference below 3 evidence, rises after', () => {
  assert.equal(confFor(1), 0);
  assert.equal(confFor(2), 0);
  assert.ok(confFor(3) >= 0.55);
  assert.ok(confFor(6) > confFor(3));
  assert.ok(confFor(3, 3) < confFor(3), 'opposing evidence damps confidence');
});

test('one command_used event does not create an inferred habit; three do', () => {
  const cmd = (): PersonalizationEvent => ({
    type: 'command_used',
    timestamp: NOW,
    summary: '/research',
    metadata: { command: '/research' },
  });
  let p = recordEvent(fresh(), cmd(), NOW);
  assert.equal(p.toolHabits.oftenUsesResearch, undefined);
  p = recordEvent(p, cmd(), NOW);
  p = recordEvent(p, cmd(), NOW);
  assert.equal(p.toolHabits.oftenUsesResearch?.value, true);
  assert.ok((p.toolHabits.oftenUsesResearch?.confidence ?? 0) >= 0.55);
});

test('preferredMode inference flips toward the dominant choice', () => {
  const ev = (value: string): PersonalizationEvent => ({
    type: 'settings_changed',
    timestamp: NOW,
    summary: `mode=${value}`,
    metadata: { key: 'mode', value },
  });
  let p = fresh();
  for (let i = 0; i < 4; i++) p = recordEvent(p, ev('auto'), NOW);
  assert.equal(p.toolHabits.preferredMode?.value, 'auto');
});

test('a slow benchmark is remembered as a performance note', () => {
  const ev: PersonalizationEvent = {
    type: 'model_benchmark',
    timestamp: NOW,
    summary: 'x',
    metadata: { modelId: 'ornith:35b', tier: 'slow', fullGpu: true },
  };
  const p = recordEvent(fresh(), ev, NOW);
  assert.equal(p.modelAndPerformance.laptopPerformanceNotes.length, 1);
  assert.match(p.modelAndPerformance.laptopPerformanceNotes[0]!.text, /ornith:35b/);
});
