import type { ToolRegistry } from '../registry.js';

/**
 * Interaction tool: ask_user. The agent loop normally intercepts this and routes
 * it to the on-screen option picker; the execute here is the headless fallback.
 */
export function registerInteractionTools(registry: ToolRegistry): void {
  registry.register({
    name: 'ask_user',
    description:
      'Ask the user to choose between concrete options instead of asking in free ' +
      'text. Use this whenever you need a decision, preference, or clarification — ' +
      'e.g. which approach to take, which file to edit, or a yes/no confirmation. ' +
      'Provide 2-5 short, specific options. Do NOT add an "other"/"type your own" ' +
      'option: the user is always offered that automatically. Returns the chosen text.',
    parameters: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'The question to put to the user.' },
        options: {
          type: 'array',
          items: { type: 'string' },
          description: '2-5 short answer options for the user to pick from.',
        },
      },
      required: ['question', 'options'],
    },
    async execute({ question }) {
      // Reached only without an interactive UI (e.g. headless). The agent loop
      // normally intercepts ask_user and routes it to the on-screen picker.
      return (
        `(No interactive prompt is available to ask: "${String(question)}".) ` +
        `Proceed with the most reasonable assumption and state it explicitly.`
      );
    },
  });
}
