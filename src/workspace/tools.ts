import type { ToolRegistry } from '../tools/registry.js';
import {
  createProject,
  listProjects,
  loadProject,
  getActiveProject,
  setActiveProject,
  projectPaths,
  type ProjectMeta,
} from './project.js';
import { initPaper } from './paper.js';

function describe(meta: ProjectMeta): string {
  const p = projectPaths(meta.slug);
  const head = [
    `Project: ${meta.title} (${meta.slug})`,
    meta.description ? `  ${meta.description}` : '',
    meta.field ? `  field: ${meta.field}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  return (
    `${head}\n` +
    `Write files into these directories:\n` +
    `  literature:  ${p.literature}\n` +
    `  experiments: ${p.experiments}\n` +
    `  runs:        ${p.runs}\n` +
    `  results:     ${p.results}\n` +
    `  paper:       ${p.paper}`
  );
}

/**
 * Register the research-workspace tools. A project bundles the literature,
 * experiments, results, and paper for one piece of research under
 * ~/.handoff/projects/<slug>/.
 */
export function registerWorkspaceTools(registry: ToolRegistry): void {
  registry.register({
    name: 'create_project',
    description:
      'Create a new research project workspace and make it active. Scaffolds ' +
      'literature/, experiments/, runs/, results/, and paper/ directories. ' +
      'Use this when the user starts a new piece of research. A title is enough — ' +
      'do not demand a description. After it succeeds, handoff automatically shows ' +
      'the user a paper-template chooser, so do NOT ask about or set up the ' +
      'template yourself; just create the project.',
    sensitive: true,
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Human-readable project name' },
        description: { type: 'string', description: 'One-line description of the research (optional)' },
        field: { type: 'string', description: 'Research field, e.g. "linguistics" (optional)' },
      },
      required: ['title'],
    },
    async execute({ title, description, field }) {
      const meta = createProject({
        title: String(title),
        description: description ? String(description) : undefined,
        field: field ? String(field) : undefined,
      });
      return `Created and switched to project "${meta.slug}".\n\n${describe(meta)}`;
    },
  });

  registry.register({
    name: 'list_projects',
    description: 'List all research projects (newest first), marking the active one.',
    parameters: { type: 'object', properties: {} },
    async execute() {
      const projects = listProjects();
      if (projects.length === 0) return 'No projects yet. Use create_project to start one.';
      const active = getActiveProject()?.slug;
      return projects
        .map((p) => {
          const mark = p.slug === active ? '* ' : '  ';
          const desc = p.description ? ` — ${p.description}` : '';
          return `${mark}${p.slug}${desc}`;
        })
        .join('\n');
    },
  });

  registry.register({
    name: 'open_project',
    description: 'Switch the active project by its slug. Subsequent work targets it.',
    parameters: {
      type: 'object',
      properties: { slug: { type: 'string', description: 'Project slug (see list_projects)' } },
      required: ['slug'],
    },
    async execute({ slug }) {
      const meta = loadProject(String(slug));
      if (!meta) return `No project named "${String(slug)}". Use list_projects to see options.`;
      setActiveProject(meta.slug);
      return `Switched to project "${meta.slug}".\n\n${describe(meta)}`;
    },
  });

  registry.register({
    name: 'project_status',
    description:
      'Show the active research project and the absolute paths where literature, ' +
      'experiments, runs, results, and the paper should be written.',
    parameters: { type: 'object', properties: {} },
    async execute() {
      const meta = getActiveProject();
      if (!meta) return 'No active project. Use create_project or open_project first.';
      return describe(meta);
    },
  });

  registry.register({
    name: 'start_paper',
    description:
      'Initialize the paper by copying a template into paper/. ' +
      'ALWAYS call ask_user FIRST to let the user choose from the available templates — ' +
      'built-in venues plus any the user added under ~/.handoff/templates. ' +
      'Then call this tool with the matching key. The whole template folder — styles, ' +
      '.bst, checklist, and every file needed to render the PDF — is copied into paper/. ' +
      'Refuses if main.tex already exists to avoid overwriting work.',
    sensitive: true,
    parameters: {
      type: 'object',
      properties: {
        template: {
          type: 'string',
          description:
            'Template key chosen by the user (e.g. blank, acl, neurips, or a user-added folder name)',
        },
      },
      required: ['template'],
    },
    async execute({ template }) {
      const meta = getActiveProject();
      if (!meta) return 'No active project. Use create_project first.';
      const result = initPaper(meta, String(template));
      return result.message;
    },
  });
}
