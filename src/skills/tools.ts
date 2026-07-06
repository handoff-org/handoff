import type { ToolRegistry } from '../tools/registry.js';
import { loadSkills, findSkill } from './store.js';

/** Register tools that let the agent discover and run user-defined skills. */
export function registerSkillTools(registry: ToolRegistry): void {
  registry.register({
    name: 'list_skills',
    description: 'List the user-defined skills available, with their descriptions.',
    parameters: { type: 'object', properties: {} },
    async execute() {
      const skills = loadSkills();
      if (skills.length === 0) {
        return 'No skills defined yet. The user can create one with /compose-skill.';
      }
      return skills.map((s) => `- ${s.name}: ${s.description}`).join('\n');
    },
  });

  registry.register({
    name: 'use_skill',
    description:
      'Load the full instructions for a user-defined skill by name, then follow them. ' +
      'Call list_skills first if you do not know the available skill names.',
    parameters: {
      type: 'object',
      properties: { name: { type: 'string', description: 'The skill name' } },
      required: ['name'],
    },
    async execute({ name }) {
      const skill = findSkill(String(name));
      if (!skill) {
        return `No skill named "${name}". Use list_skills to see what's available.`;
      }
      return `Skill "${skill.name}" — follow these instructions:\n\n${skill.body}`;
    },
  });
}
