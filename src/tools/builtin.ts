import type { ToolRegistry } from './registry.js';
import { registerFilesystemTools } from './builtin/filesystem.js';
import { registerSearchTools } from './builtin/search.js';
import { registerShellTools } from './builtin/shell.js';
import { registerWebTools } from './builtin/web.js';
import { registerPdfTools } from './builtin/pdf.js';
import { registerLatexTools } from './builtin/latex.js';
import { registerInteractionTools } from './builtin/interaction.js';

/**
 * Register the built-in agent tools. Each group lives in its own module under
 * ./builtin/ (schema + validation + execution + safety metadata together); this
 * aggregator just wires them into the registry in a stable order. Consumers
 * (src/index.tsx, adapters, qa) keep importing `registerBuiltins` from here.
 */
export function registerBuiltins(registry: ToolRegistry): void {
  registerFilesystemTools(registry); // read/write/edit files, dirs
  registerSearchTools(registry); // search_files, find_files
  registerShellTools(registry); // run_shell
  registerWebTools(registry); // web_fetch, web_search
  registerPdfTools(registry); // read_pdf
  registerLatexTools(registry); // compile_paper, fix_paper_errors
  registerInteractionTools(registry); // ask_user
}
