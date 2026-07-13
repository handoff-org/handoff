import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshHome } from './helpers.js';

const home = freshHome();
const { createProject } = await import('../src/workspace/project.js');
const {
  readBindings,
  appendBinding,
  removeBinding,
  newBindingId,
  bindingsPath,
} = await import('../src/workspace/bindings.js');

const proj = createProject({ title: 'Test Bindings Project' });
const slug = proj.slug;

function makeBinding(overrides: Partial<Parameters<typeof appendBinding>[1]> = {}) {
  return {
    id: newBindingId(),
    file: 'paper/main.tex',
    line: 42,
    raw: '92.1',
    value: 92.1,
    runId: 'run_001',
    metricKey: 'acc',
    confidence: 1.0,
    boundAt: new Date().toISOString(),
    ...overrides,
  };
}

test('readBindings returns empty array when no file', () => {
  assert.deepEqual(readBindings('no-such-slug'), []);
});

test('appendBinding adds a binding', () => {
  const b = makeBinding();
  appendBinding(slug, b);
  const bindings = readBindings(slug);
  assert.equal(bindings.length, 1);
  assert.equal(bindings[0]!.id, b.id);
  assert.equal(bindings[0]!.raw, '92.1');
  assert.equal(bindings[0]!.value, 92.1);
});

test('appendBinding adds multiple bindings', () => {
  appendBinding(slug, makeBinding({ id: newBindingId(), line: 55, raw: '0.87', value: 0.87 }));
  const bindings = readBindings(slug);
  assert.equal(bindings.length, 2);
});

test('removeBinding removes a specific id', () => {
  const b = makeBinding({ id: newBindingId(), line: 99, raw: '10.5', value: 10.5 });
  appendBinding(slug, b);
  const before = readBindings(slug);
  assert.equal(before.length, 3);

  removeBinding(slug, b.id);
  const after = readBindings(slug);
  assert.equal(after.length, 2);
  assert.ok(!after.some((x) => x.id === b.id));
});

test('removeBinding is a no-op for unknown id', () => {
  const before = readBindings(slug).length;
  removeBinding(slug, 'b_nonexistent');
  assert.equal(readBindings(slug).length, before);
});

test('newBindingId generates unique ids', () => {
  const ids = new Set(Array.from({ length: 50 }, () => newBindingId()));
  assert.equal(ids.size, 50);
});

test('round-trip: values survive JSON serialization', () => {
  const b = makeBinding({ id: newBindingId(), value: 3.14159, raw: '3.14159', metricKey: 'loss' });
  appendBinding(slug, b);
  const found = readBindings(slug).find((x) => x.id === b.id);
  assert.ok(found);
  assert.equal(found!.value, 3.14159);
  assert.equal(found!.metricKey, 'loss');
});
