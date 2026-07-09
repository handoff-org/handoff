import type { AssertionResult, CheckApi } from './types.js';

// Small builders + common assertions for scenario `check` hooks. Each returns an
// AssertionResult; the harness logs them and fails the scenario on any failed
// assertion whose severity is 'failure'.

export function pass(name: string, notes?: string): AssertionResult {
  return { name, passed: true, severity: 'failure', ...(notes ? { notes } : {}) };
}

export function fail(
  name: string,
  opts: {
    expected?: unknown;
    actual?: unknown;
    notes?: string;
    severity?: 'failure' | 'warning';
  } = {},
): AssertionResult {
  return {
    name,
    passed: false,
    severity: opts.severity ?? 'failure',
    ...(opts.expected !== undefined ? { expected: opts.expected } : {}),
    ...(opts.actual !== undefined ? { actual: opts.actual } : {}),
    ...(opts.notes ? { notes: opts.notes } : {}),
  };
}

export function check(
  name: string,
  condition: boolean,
  opts: {
    expected?: unknown;
    actual?: unknown;
    notes?: string;
    severity?: 'failure' | 'warning';
  } = {},
): AssertionResult {
  return condition ? pass(name, opts.notes) : fail(name, opts);
}

// ── Common reusable assertions ────────────────────────────────────────────────

export function fileExists(api: CheckApi, path: string): AssertionResult {
  return check(`file exists: ${path}`, api.fileExists(path), { actual: 'missing' });
}

export function fileContains(api: CheckApi, path: string, needle: string): AssertionResult {
  const content = api.readFile(path);
  return check(
    `file ${path} contains ${JSON.stringify(needle)}`,
    !!content && content.includes(needle),
    {
      actual: content == null ? 'file missing' : 'substring not found',
    },
  );
}

export function noErrors(api: CheckApi): AssertionResult {
  const errs = api.errors();
  return check('no error/timeout events', errs.length === 0, {
    actual: errs.map((e) => e.error?.message ?? e.message ?? e.kind),
  });
}

/** No file was created or modified outside the isolated temp HOME. */
export function noWriteOutsideHome(api: CheckApi): AssertionResult {
  const escapes = api
    .toolResults()
    .filter((r) => /wrote|created|edited|appended|saved/i.test(r.output ?? ''))
    .filter(
      (r) =>
        /(^|[^a-zA-Z0-9_./-])\/(?!.*qa-home)/.test(r.output ?? '') &&
        !(r.output ?? '').includes(api.homeDir),
    );
  // Heuristic only; the strong guarantee is the runner's post-scenario fs scan.
  return check('no write path outside temp HOME (heuristic)', escapes.length === 0, {
    actual: escapes.map((r) => r.output),
    severity: 'warning',
  });
}
