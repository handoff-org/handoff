/**
 * TypeScript mirror of evals/schema/scenario.schema.json. The JSON Schema is the
 * source of truth for validation; these types give authoring/runtime ergonomics.
 */

export type Layer = 'direct' | 'agent' | 'product' | 'transport';

export type Category =
  | 'smoke'
  | 'core'
  | 'ambiguity'
  | 'evidence-synthesis'
  | 'citation-integrity'
  | 'claim-decomposition'
  | 'conflicting-evidence'
  | 'numerical'
  | 'reproducibility'
  | 'long-context'
  | 'prompt-injection'
  | 'privacy'
  | 'tool-use'
  | 'abstention'
  | 'writing'
  | 'self-correction'
  | 'ux-quality'
  | 'adversarial'
  | 'streaming'
  | 'relay'
  | 'stress';

export type Difficulty = 'easy' | 'medium' | 'hard';

export type AssertionType =
  | 'contains'
  | 'not_contains'
  | 'regex'
  | 'numeric_answer'
  | 'no_unknown_citation_ids'
  | 'citation_stance_matches'
  | 'no_secret_in_output'
  | 'no_unapproved_network_calls'
  | 'required_tools_called'
  | 'forbidden_tools_not_called'
  | 'expected_file_exists'
  | 'forbidden_file_unchanged'
  | 'latex_parses'
  | 'cite_keys_preserved'
  | 'acknowledges_uncertainty'
  | 'acknowledges_conflict'
  | 'asks_clarification'
  | 'no_duplicate_streaming_text'
  | 'json_matches_schema';

export interface Assertion {
  type: AssertionType;
  hardGate?: boolean;
  value?: unknown;
  flags?: string;
  tolerance?: number;
}

export type MockStepKind =
  | 'text'
  | 'tools'
  | 'malformed_tool'
  | 'duplicate_tool'
  | 'slow'
  | 'throw'
  | 'overlong'
  | 'truncated_reasoning'
  | 'empty';

export interface MockStep {
  kind: MockStepKind;
  text?: string;
  calls?: { name: string; args?: unknown }[];
  name?: string;
  rawArgs?: string;
  message?: string;
  sizeChars?: number;
}

export interface MockToolResponse {
  result?: string;
  error?: string;
  network?: boolean;
  sensitive?: boolean;
}

export interface GroundTruthClaim {
  id: string;
  stance: 'supported' | 'contradicted' | 'mixed' | 'unsupported' | 'insufficient';
  supportingSources?: string[];
  contradictingSources?: string[];
  confidenceRange?: [number, number];
}

export interface Scenario {
  schemaVersion?: 1;
  id: string;
  version: number;
  title: string;
  description?: string;
  detects?: string;
  layer: Layer;
  category: Category;
  difficulty: Difficulty;
  tags?: string[];
  seed?: number;
  repeat?: number;
  allowedNondeterminism?: 'none' | 'low' | 'high';
  persona?: {
    role?: string;
    expertise?: 'novice' | 'intermediate' | 'advanced' | 'expert';
    communicationPreference?: string;
  };
  environment?: {
    network?: 'mocked' | 'offline' | 'live';
    cloudAllowed?: boolean;
    relayEnabled?: boolean;
    projectFixture?: string;
    corpusFixture?: string;
    conversationFixture?: string;
  };
  modelConfig?: { temperature?: number; contextSize?: number; think?: unknown };
  mockModel?: MockStep[];
  mockTools?: Record<string, MockToolResponse>;
  turns: { user: string }[];
  expected: {
    requiredBehaviors?: string[];
    forbiddenBehaviors?: string[];
    requiredTools?: string[];
    forbiddenTools?: string[];
    assertions?: Assertion[];
    rubric?: Record<string, string>;
  };
  groundTruth?: {
    validCitationIds?: string[];
    claims?: GroundTruthClaim[];
  };
  performance?: { maximumWallTimeMs?: number };
  cleanup?: boolean;
  generated?: { from: string; seed: number; mutations: string[] };
}

// ── Result types (produced by the runner) ────────────────────────────────────

export type Severity = 'critical' | 'high' | 'medium' | 'low';

export type Taxonomy =
  | 'MODEL_REASONING'
  | 'MODEL_INSTRUCTION_FOLLOWING'
  | 'MODEL_HALLUCINATION'
  | 'MODEL_UNCERTAINTY'
  | 'MODEL_LONG_CONTEXT'
  | 'MODEL_WRITING'
  | 'MODEL_FORMATTING'
  | 'CITATION_FABRICATION'
  | 'CITATION_MISMATCH'
  | 'EVIDENCE_MISINTERPRETATION'
  | 'NUMERICAL_ERROR'
  | 'TOOL_SELECTION'
  | 'TOOL_ARGUMENT'
  | 'TOOL_RESULT_INTERPRETATION'
  | 'TOOL_RECOVERY'
  | 'PROMPT_ASSEMBLY'
  | 'CONTEXT_RETRIEVAL'
  | 'CONTEXT_COMPACTION'
  | 'PROJECT_MEMORY'
  | 'PRIVACY_LEAK'
  | 'PROMPT_INJECTION'
  | 'UNAPPROVED_NETWORK_ACCESS'
  | 'SECRET_REDACTION'
  | 'STREAMING_CORRUPTION'
  | 'UI_PRESENTATION'
  | 'RELAY_TRANSPORT'
  | 'PROVIDER_FAILURE'
  | 'PERFORMANCE_REGRESSION'
  | 'TEST_HARNESS'
  | 'FLAKY_SCENARIO'
  | 'JUDGE_ERROR'
  | 'FIXTURE_ERROR';

export interface AssertionResult {
  type: AssertionType;
  passed: boolean;
  hardGate: boolean;
  severity: Severity;
  taxonomy: Taxonomy;
  detail: string;
}

export interface ToolTraceEntry {
  name: string;
  args: string;
  ok: boolean;
  result: string;
  network: boolean;
}

export interface ScenarioResult {
  scenarioId: string;
  scenarioVersion: number;
  seed: number;
  layer: Layer;
  category: Category;
  difficulty: Difficulty;
  repeatIndex: number;
  passed: boolean;
  skipped: boolean;
  skipReason?: string;
  assertions: AssertionResult[];
  rubric?: Record<string, number>;
  hardGateFailed: boolean;
  severity: Severity | null;
  taxonomy: Taxonomy[];
  finalAnswer: string;
  transcript: { role: string; content: string }[];
  toolTrace: ToolTraceEntry[];
  artifacts: string[];
  timings: { wallMs: number; timeToFirstTokenMs: number | null };
  tokens: { prompt: number; output: number };
  fingerprint?: string;
}
