/**
 * What a tool returns. The common case is plain text; a vision tool can also
 * attach base64 images (no `data:` prefix) that the loop forwards to the model
 * on the tool-result message. `execute` may return a bare string for
 * convenience — the registry normalizes it to `{ text }`.
 */
export interface ToolResult {
  text: string;
  images?: string[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<
      string,
      {
        type: string;
        description?: string;
        items?: { type: string };
        enum?: string[];
      }
    >;
    required?: string[];
  };
  /** Mutating/dangerous tools that should require approval in permissions mode. */
  sensitive?: boolean;
  /**
   * Side-effect-free read tools (web/file/search reads) that are safe to run
   * concurrently with each other. When a turn's tool calls are ALL parallel-safe,
   * the agent loop executes them at once instead of one-at-a-time, cutting the
   * wall-clock latency of multi-lookup research turns to that of the slowest call.
   * Approval is unaffected — a parallel-safe tool can still be `sensitive` (e.g.
   * a network read) and is still gated; only its *execution* is parallelized.
   */
  parallelSafe?: boolean;
  execute: (args: Record<string, unknown>) => Promise<string | ToolResult>;
}

export interface ToolSchema {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: ToolDefinition['parameters'];
  };
}

export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();

  register(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  getSchemas(): ToolSchema[] {
    return Array.from(this.tools.values()).map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
  }

  /**
   * Run a tool and return its full result, including any attached images.
   * The agent loop uses this so vision tools can forward images to the model.
   */
  async callFull(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) return { text: `Error: unknown tool "${name}"` };
    try {
      const out = await tool.execute(args);
      return typeof out === 'string' ? { text: out } : out;
    } catch (err) {
      return { text: `Error: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  /** Run a tool and return just its text output. Convenience over `callFull`. */
  async call(name: string, args: Record<string, unknown>): Promise<string> {
    return (await this.callFull(name, args)).text;
  }

  list(): string[] {
    return Array.from(this.tools.keys());
  }

  isSensitive(name: string): boolean {
    return this.tools.get(name)?.sensitive ?? false;
  }

  /** True if the tool is a side-effect-free read safe to run concurrently. */
  isParallelSafe(name: string): boolean {
    return this.tools.get(name)?.parallelSafe ?? false;
  }
}
