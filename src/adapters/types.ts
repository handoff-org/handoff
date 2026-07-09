// Shared types for all benchmark eval adapters.

export interface BenchTask {
  id: string;
  /** Full prompt shown to the agent (task description + context). */
  prompt: string;
  /** Ground-truth answer used for scoring. */
  expected: string;
  difficulty?: string;
  domain?: string;
  /** Extra metadata preserved in results (paper id, capsule id, etc.). */
  meta?: Record<string, unknown>;
}

export interface TaskResult {
  taskId: string;
  benchmark: string;
  difficulty?: string;
  domain?: string;
  passed: boolean;
  /** Answer the agent submitted via the submit_answer tool, or null if it never did. */
  predicted: string | null;
  expected: string;
  turns: number;
  toolCalls: number;
  durationMs: number;
  error?: string;
}

export interface BenchmarkRun {
  runId: string;
  benchmark: string;
  model: string;
  backend: string;
  timestamp: string;
  totalTasks: number;
  passed: number;
  passRate: number;
  avgTurns: number;
  avgToolCalls: number;
  avgDurationMs: number;
  byDifficulty: Record<string, { total: number; passed: number }>;
  byDomain: Record<string, { total: number; passed: number }>;
  results: TaskResult[];
}
