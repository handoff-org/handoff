import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPersonalizationPrompt, type PromptContext } from '../src/personalization/prompt.js';
import { detectExplicitPreference, applyExplicit } from '../src/personalization/learn.js';
import { defaultProfile, type AdaptiveProfile } from '../src/personalization/profile.js';

const NOW = '2026-07-05T12:00:00.000Z';

/** A profile with a couple of explicit prefs (verbosity + paper template + language). */
function sample(): AdaptiveProfile {
  let p = defaultProfile(NOW);
  p = applyExplicit(
    p,
    detectExplicitPreference('from now on I prefer short answers')!,
    'prefers concise answers',
    NOW,
  );
  p = applyExplicit(
    p,
    detectExplicitPreference('always use the NeurIPS format')!,
    'prefers the NeurIPS paper template',
    NOW,
  );
  p = applyExplicit(
    p,
    detectExplicitPreference('I prefer python for experiments')!,
    'prefers python for experiments/code',
    NOW,
  );
  return p;
}

const ctx = (over: Partial<PromptContext> = {}): PromptContext => ({
  enabled: true,
  includeInPrompt: true,
  isCloudBackend: false,
  allowCloud: false,
  focus: 'research',
  ...over,
});

test('disabled or not-included → empty string', () => {
  assert.equal(buildPersonalizationPrompt(sample(), ctx({ enabled: false })), '');
  assert.equal(buildPersonalizationPrompt(sample(), ctx({ includeInPrompt: false })), '');
});

test('empty profile → empty string', () => {
  assert.equal(buildPersonalizationPrompt(defaultProfile(NOW), ctx()), '');
});

test('renders a compact, deterministic block', () => {
  const a = buildPersonalizationPrompt(sample(), ctx());
  const b = buildPersonalizationPrompt(sample(), ctx());
  assert.equal(a, b, 'deterministic');
  assert.match(a, /User preferences/);
  assert.match(a, /concise answers/);
  assert.ok(a.length < 1200, 'stays compact');
});

test('cloud backend excludes the profile unless allowed', () => {
  assert.equal(
    buildPersonalizationPrompt(sample(), ctx({ isCloudBackend: true, allowCloud: false })),
    '',
  );
  assert.notEqual(
    buildPersonalizationPrompt(sample(), ctx({ isCloudBackend: true, allowCloud: true })),
    '',
  );
});

test('focus=general keeps global style but drops project/research lines', () => {
  const general = buildPersonalizationPrompt(sample(), ctx({ focus: 'general' }));
  assert.match(general, /concise answers/); // global style survives
  assert.doesNotMatch(general, /NeurIPS/); // research-specific line dropped
});

test('low-confidence inferred entries are omitted', () => {
  const p = defaultProfile(NOW);
  // An inferred value below the 0.6 threshold must not appear.
  p.interactionStyle.prefersBullets = {
    value: true,
    confidence: 0.55,
    evidenceCount: 3,
    updatedAt: NOW,
  };
  assert.equal(buildPersonalizationPrompt(p, ctx()), '');
});
