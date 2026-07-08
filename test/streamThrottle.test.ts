import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCoalescer } from '../ui/streamThrottle.js';

/** A controllable clock for deterministic tests. */
function fakeClock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

test('first push emits immediately', () => {
  const clock = fakeClock();
  const seen: string[] = [];
  const c = makeCoalescer<string>(33, (v) => seen.push(v), clock.now);
  c.push('a');
  assert.deepEqual(seen, ['a']);
});

test('rapid pushes within one interval collapse to a single emit', () => {
  const clock = fakeClock();
  const seen: string[] = [];
  const c = makeCoalescer<string>(33, (v) => seen.push(v), clock.now);
  c.push('a'); // t=0 → emit
  clock.advance(5);
  c.push('ab'); // deferred
  clock.advance(5);
  c.push('abc'); // deferred
  assert.deepEqual(seen, ['a'], 'only the leading push emitted');
  c.flush(); // deliver the latest deferred value
  assert.deepEqual(seen, ['a', 'abc']);
});

test('a push after the interval emits again', () => {
  const clock = fakeClock();
  const seen: string[] = [];
  const c = makeCoalescer<string>(33, (v) => seen.push(v), clock.now);
  c.push('a'); // t=0 emit
  clock.advance(40); // past interval
  c.push('ab'); // emit again
  assert.deepEqual(seen, ['a', 'ab']);
});

test('flush with no pending value does nothing', () => {
  const clock = fakeClock();
  const seen: string[] = [];
  const c = makeCoalescer<string>(33, (v) => seen.push(v), clock.now);
  c.push('a'); // emitted, nothing pending after
  c.flush();
  c.flush();
  assert.deepEqual(seen, ['a']);
});

test('reset clears the interval clock so the next push emits immediately', () => {
  const clock = fakeClock();
  const seen: string[] = [];
  const c = makeCoalescer<string>(33, (v) => seen.push(v), clock.now);
  c.push('a'); // t=0 emit
  clock.advance(5);
  c.push('ab'); // deferred (within interval)
  c.reset(); // new stream
  c.push('x'); // must emit immediately despite being <33ms since last
  assert.deepEqual(seen, ['a', 'x']);
  c.flush(); // nothing pending (the deferred 'ab' was dropped by reset)
  assert.deepEqual(seen, ['a', 'x']);
});

test('flush emits the most recent value only, not intermediate ones', () => {
  const clock = fakeClock();
  const seen: string[] = [];
  const c = makeCoalescer<string>(100, (v) => seen.push(v), clock.now);
  c.push('1'); // emit
  clock.advance(10);
  c.push('12'); // deferred
  clock.advance(10);
  c.push('123'); // deferred (overwrites)
  clock.advance(10);
  c.push('1234'); // deferred (overwrites)
  c.flush();
  assert.deepEqual(seen, ['1', '1234']);
});
