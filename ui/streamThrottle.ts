/**
 * A leading-edge coalescer for high-frequency updates. Streaming a model
 * response fires a `message_delta` per chunk (often per token); calling
 * `setStreaming(acc)` on each one triggers one React render + a full transcript
 * re-layout per token, which stutters on long responses.
 *
 * This throttles those updates to at most one per `intervalMs` (≈30fps at 33ms)
 * while never losing the final value — the caller flushes explicitly when the
 * stream ends. The clock is injectable so it can be unit-tested deterministically
 * (no reliance on real timers or wall-clock).
 */

export interface Coalescer<T> {
  /** Record a new value; emits immediately if a full interval has elapsed, else defers it. */
  push(value: T): void;
  /** Emit the most recent deferred value, if any (call when the stream ends). */
  flush(): void;
  /** Forget any deferred value and reset the interval clock (start of a new stream). */
  reset(): void;
}

export function makeCoalescer<T>(
  intervalMs: number,
  emit: (value: T) => void,
  now: () => number = Date.now,
): Coalescer<T> {
  let lastEmit = -Infinity;
  let hasPending = false;
  let pending: T;

  return {
    push(value: T): void {
      const t = now();
      if (t - lastEmit >= intervalMs) {
        lastEmit = t;
        hasPending = false;
        emit(value);
      } else {
        pending = value;
        hasPending = true;
      }
    },
    flush(): void {
      if (hasPending) {
        lastEmit = now();
        hasPending = false;
        emit(pending);
      }
    },
    reset(): void {
      lastEmit = -Infinity;
      hasPending = false;
    },
  };
}
