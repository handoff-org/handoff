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
  execute: (args: Record<string, unknown>) => Promise<string>;
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

  async call(name: string, args: Record<string, unknown>): Promise<string> {
    const tool = this.tools.get(name);
    if (!tool) return `Error: unknown tool "${name}"`;
    try {
      return await tool.execute(args);
    } catch (err) {
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  list(): string[] {
    return Array.from(this.tools.keys());
  }

  isSensitive(name: string): boolean {
    return this.tools.get(name)?.sensitive ?? false;
  }
}
