import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import Ajv from 'ajv';
import type { Scenario } from '../schema/types.js';

const HERE = dirname(fileURLToPath(import.meta.url));
/** evals/ root, resolved relative to this module (works regardless of cwd). */
export const EVALS_ROOT = resolve(HERE, '..');

export interface LoadIssue {
  file: string;
  scenarioId?: string;
  message: string;
}

export interface LoadResult {
  scenarios: Scenario[];
  issues: LoadIssue[];
}

let _validate: ((s: unknown) => { ok: boolean; errors: string[] }) | null = null;

/** Compile the JSON Schema once. Draft-07 Ajv handles our constructs; we strip
 *  the 2020-12 `$schema`/`$id` so we don't need the 2020 meta-schema loaded. */
function getValidator() {
  if (_validate) return _validate;
  const schemaPath = join(EVALS_ROOT, 'schema', 'scenario.schema.json');
  const schema = JSON.parse(readFileSync(schemaPath, 'utf8')) as Record<string, unknown>;
  delete schema['$schema'];
  delete schema['$id'];
  const ajv = new Ajv({ strict: false, allErrors: true });
  const fn = ajv.compile(schema);
  _validate = (s: unknown) => {
    const ok = fn(s) as boolean;
    const errors = (fn.errors ?? []).map((e) =>
      `${e.instancePath || '/'} ${e.message ?? ''}`.trim(),
    );
    return { ok, errors };
  };
  return _validate;
}

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else if (['.yaml', '.yml', '.json'].includes(extname(p))) out.push(p);
  }
  return out.sort();
}

function parseFile(file: string): unknown {
  const raw = readFileSync(file, 'utf8');
  return extname(file) === '.json' ? JSON.parse(raw) : parseYaml(raw);
}

/**
 * Cross-field integrity checks the JSON Schema can't express: fixture files must
 * exist, and assertions that depend on ground truth must have it. These are the
 * guards from Section 5 (no broken fixture refs, no impossible scoring criteria).
 */
function integrityIssues(s: Scenario, file: string): LoadIssue[] {
  const issues: LoadIssue[] = [];
  const env = s.environment ?? {};
  for (const key of ['projectFixture', 'corpusFixture', 'conversationFixture'] as const) {
    const rel = env[key];
    if (rel && !existsSync(join(EVALS_ROOT, rel))) {
      issues.push({ file, scenarioId: s.id, message: `${key} fixture not found: ${rel}` });
    }
  }
  const assertionTypes = new Set((s.expected.assertions ?? []).map((a) => a.type));
  if (assertionTypes.has('citation_stance_matches') && !s.groundTruth?.claims?.length) {
    issues.push({
      file,
      scenarioId: s.id,
      message: 'citation_stance_matches requires groundTruth.claims',
    });
  }
  if (
    assertionTypes.has('no_unknown_citation_ids') &&
    s.groundTruth?.validCitationIds === undefined
  ) {
    issues.push({
      file,
      scenarioId: s.id,
      message:
        'no_unknown_citation_ids requires groundTruth.validCitationIds (may be empty for "cite nothing")',
    });
  }
  // A scenario must be able to fail or pass on something.
  const hasScoring =
    (s.expected.assertions?.length ?? 0) > 0 ||
    (s.expected.requiredTools?.length ?? 0) > 0 ||
    (s.expected.forbiddenTools?.length ?? 0) > 0 ||
    (s.expected.rubric && Object.keys(s.expected.rubric).length > 0);
  if (!hasScoring) {
    issues.push({
      file,
      scenarioId: s.id,
      message: 'scenario has no assertions, tool expectations, or rubric (nothing to score)',
    });
  }
  return issues;
}

/** Load and validate every canonical scenario under evals/scenarios (plus an
 *  optional extra dir, e.g. a generated-instances dir). */
export function loadScenarios(dirs: string[] = [join(EVALS_ROOT, 'scenarios')]): LoadResult {
  const validate = getValidator();
  const scenarios: Scenario[] = [];
  const issues: LoadIssue[] = [];
  const seenIds = new Map<string, string>();

  for (const dir of dirs) {
    for (const file of walk(dir)) {
      let parsed: unknown;
      try {
        parsed = parseFile(file);
      } catch (e) {
        issues.push({ file, message: `parse error: ${(e as Error).message}` });
        continue;
      }
      const { ok, errors } = validate(parsed);
      if (!ok) {
        const id = (parsed as { id?: string })?.id;
        for (const err of errors) issues.push({ file, scenarioId: id, message: `schema: ${err}` });
        continue;
      }
      const s = parsed as Scenario;
      const prior = seenIds.get(s.id);
      if (prior) {
        issues.push({
          file,
          scenarioId: s.id,
          message: `duplicate scenario id (also in ${prior})`,
        });
        continue;
      }
      seenIds.set(s.id, file);
      issues.push(...integrityIssues(s, file));
      scenarios.push(s);
    }
  }
  return { scenarios, issues };
}

export interface Filter {
  id?: string;
  category?: string;
  tag?: string;
  difficulty?: string;
  layer?: string;
  smokeOnly?: boolean;
}

export function filterScenarios(scenarios: Scenario[], f: Filter): Scenario[] {
  return scenarios.filter((s) => {
    if (f.id && s.id !== f.id) return false;
    if (f.category && s.category !== f.category) return false;
    if (f.difficulty && s.difficulty !== f.difficulty) return false;
    if (f.layer && s.layer !== f.layer) return false;
    if (f.tag && !(s.tags ?? []).includes(f.tag)) return false;
    if (f.smokeOnly && s.category !== 'smoke') return false;
    return true;
  });
}
