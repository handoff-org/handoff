import { join } from 'path';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { projectPaths, type ProjectMeta } from './project.js';
import { blankTemplate, starterBib } from './templates.js';
import { listTemplates, resolveTemplateDir, copyTemplateInto } from './templateStore.js';
import { bibFileIn } from './overleaf.js';

export interface InitPaperResult {
  ok: boolean;
  message: string;
}

/**
 * Initialize a project's paper/ from a template. Shared by the `start_paper`
 * tool (model-driven) and the app's post-create template picker (deterministic),
 * so both take exactly the same code path.
 *
 * Copies the whole template folder (styles, .bst, checklist, main.tex) into
 * paper/, or writes a minimal skeleton for the code-generated "blank" key. Seeds
 * refs.bib when the template ships no .bib. Refuses if main.tex already exists.
 */
export function initPaper(meta: ProjectMeta, templateKey: string): InitPaperResult {
  const p = projectPaths(meta.slug);
  const mainPath = join(p.paper, 'main.tex');
  if (existsSync(mainPath)) {
    return { ok: false, message: 'paper/main.tex already exists — edit it directly with write_file.' };
  }

  const key = String(templateKey);
  const choices = listTemplates();
  const choice = choices.find((c) => c.key === key);
  if (!choice) {
    const list = choices.map((c) => `${c.key} (${c.label})`).join(', ');
    return { ok: false, message: `Unknown template "${key}". Available templates: ${list}.` };
  }

  mkdirSync(p.paper, { recursive: true });
  const dir = resolveTemplateDir(key);
  if (dir) {
    // All render materials live in the template folder — copy the whole thing.
    copyTemplateInto(dir, p.paper, meta.title);
  } else {
    // No folder for this key (blank): generate a minimal skeleton.
    writeFileSync(mainPath, blankTemplate(meta.title), 'utf-8');
  }

  // Ensure a bibliography sits next to main.tex. Templates that ship their own
  // .bib keep it; otherwise seed refs.bib. Never clobber an existing .bib.
  let bibNote = '';
  if (!bibFileIn(p.paper)) {
    writeFileSync(join(p.paper, 'refs.bib'), starterBib(meta.title), 'utf-8');
    bibNote = ' and refs.bib';
  }

  const source = dir ? `${choice.label} template folder` : `${choice.label} template`;
  return { ok: true, message: `Created main.tex${bibNote} in ${p.paper} from the ${source}.` };
}
