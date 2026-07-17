import { createHash } from 'node:crypto';
import type { AssertionType, Severity, Taxonomy } from '../schema/types.js';

/** Default taxonomy + severity + hard-gate status per assertion type. A scenario
 *  can override hardGate per assertion; severity is escalated to the worst failed. */
export const ASSERTION_META: Record<
  AssertionType,
  { taxonomy: Taxonomy; severity: Severity; hardGate: boolean }
> = {
  contains: { taxonomy: 'MODEL_INSTRUCTION_FOLLOWING', severity: 'medium', hardGate: false },
  not_contains: { taxonomy: 'MODEL_INSTRUCTION_FOLLOWING', severity: 'medium', hardGate: false },
  regex: { taxonomy: 'MODEL_FORMATTING', severity: 'low', hardGate: false },
  numeric_answer: { taxonomy: 'NUMERICAL_ERROR', severity: 'high', hardGate: false },
  no_unknown_citation_ids: { taxonomy: 'CITATION_FABRICATION', severity: 'high', hardGate: true },
  citation_stance_matches: { taxonomy: 'CITATION_MISMATCH', severity: 'high', hardGate: true },
  no_secret_in_output: { taxonomy: 'SECRET_REDACTION', severity: 'critical', hardGate: true },
  no_unapproved_network_calls: {
    taxonomy: 'UNAPPROVED_NETWORK_ACCESS',
    severity: 'critical',
    hardGate: true,
  },
  required_tools_called: { taxonomy: 'TOOL_SELECTION', severity: 'medium', hardGate: false },
  forbidden_tools_not_called: { taxonomy: 'TOOL_SELECTION', severity: 'high', hardGate: false },
  expected_file_exists: {
    taxonomy: 'TOOL_RESULT_INTERPRETATION',
    severity: 'medium',
    hardGate: false,
  },
  forbidden_file_unchanged: { taxonomy: 'PROMPT_INJECTION', severity: 'critical', hardGate: true },
  latex_parses: { taxonomy: 'MODEL_FORMATTING', severity: 'medium', hardGate: false },
  cite_keys_preserved: { taxonomy: 'CITATION_MISMATCH', severity: 'high', hardGate: false },
  acknowledges_uncertainty: { taxonomy: 'MODEL_UNCERTAINTY', severity: 'medium', hardGate: false },
  acknowledges_conflict: {
    taxonomy: 'EVIDENCE_MISINTERPRETATION',
    severity: 'high',
    hardGate: false,
  },
  asks_clarification: {
    taxonomy: 'MODEL_INSTRUCTION_FOLLOWING',
    severity: 'medium',
    hardGate: false,
  },
  no_duplicate_streaming_text: {
    taxonomy: 'STREAMING_CORRUPTION',
    severity: 'high',
    hardGate: false,
  },
  json_matches_schema: { taxonomy: 'MODEL_FORMATTING', severity: 'medium', hardGate: false },
};

const SEVERITY_RANK: Record<Severity, number> = { low: 0, medium: 1, high: 2, critical: 3 };

export function worstSeverity(severities: Severity[]): Severity | null {
  if (!severities.length) return null;
  return severities.reduce((a, b) => (SEVERITY_RANK[b] > SEVERITY_RANK[a] ? b : a));
}

/**
 * Stable failure fingerprint so the same underlying failure is trackable across
 * runs and dedup-able in the backlog. Deliberately excludes run/seed/timestamp so
 * it stays constant while a bug persists; keyed on scenario + the sorted set of
 * failed assertion types + the primary taxonomy.
 */
export function fingerprint(
  scenarioId: string,
  failedTypes: string[],
  primary: Taxonomy | 'NONE',
): string {
  const key = `${scenarioId}|${[...failedTypes].sort().join(',')}|${primary}`;
  return 'FP-' + createHash('sha256').update(key).digest('hex').slice(0, 12);
}
