export interface Command {
  name: string;
  desc: string;
}

/** The slash commands shown in the menu, banner, and `/help`. */
export const COMMANDS: Command[] = [
  { name: '/project', desc: 'switch, create, or delete a project  (/project new <name>)' },
  { name: '/research', desc: 'fact-check a claim against the literature' },
  { name: '/note', desc: 'jot a note in the project lab notebook  (/note <text>)' },
  { name: '/overleaf', desc: 'connect & sync your paper with Overleaf' },
  { name: '/zotero', desc: 'connect your Zotero library' },
  {
    name: '/zotero-prep',
    desc: 'highlight a Zotero paper: annotate key sentences in the PDF with comments  (/zotero-prep <paper>)',
  },
  { name: '/openreview', desc: 'fetch your submissions & reviewer feedback, help respond' },
  { name: '/compose-skill', desc: 'write a new skill in your editor' },
  { name: '/skill', desc: 'run a skill  (/skill <name>)' },
  { name: '/skills', desc: 'list your skills' },
  {
    name: '/model',
    desc: 'pick a model  (/model cool·fast·balanced·deep · fast·think tier override · doctor · benchmark)',
  },
  { name: '/settings', desc: 'inference preset, personalization, theme, or Ollama tuning' },
  {
    name: '/profile',
    desc: 'view or manage what handoff has learned  (show · forget · reset · disable)',
  },
  { name: '/mode', desc: 'toggle hands-on / hands-off' },
  { name: '/audit-paper', desc: 'scan paper/ for unsupported claims and numbers' },
  { name: '/provenance', desc: 'check that paper numbers still match their linked runs' },
  { name: '/claims', desc: 'show all tracked claims with status' },
  { name: '/unsupported', desc: 'list claims with no linked evidence' },
  { name: '/claim-add', desc: 'add a claim  (/claim-add <text>)' },
  { name: '/claim-status', desc: 'full detail for one claim  (/claim-status <id>)' },
  { name: '/claim-link-run', desc: 'link a run as evidence  (/claim-link-run <id> <run_id>)' },
  { name: '/claim-link-paper', desc: 'link a citation  (/claim-link-paper <id> <key>)' },
  {
    name: '/note-paper',
    desc: 'annotate a paper with key passages and relevance  (/note-paper <id>)',
  },
  { name: '/lit-notes', desc: 'list structured notes for papers  (/lit-notes [paper_id])' },
  {
    name: '/snowball',
    desc: 'expand forward/backward citations  (/snowball <id> [forward|backward|both])',
  },
  { name: '/lit-review', desc: 'draft Related Work from paper notes  (/lit-review [tag …])' },
  {
    name: '/bind',
    desc: 'bind a number in the paper to a run metric  (/bind <file> <line> <raw> <run_id> <metric>)',
  },
  { name: '/list-bindings', desc: 'show all metric bindings' },
  { name: '/auto-link', desc: 'suggest run bindings for unlinked numbers in the paper' },
  {
    name: '/stats',
    desc: 'compute CIs and effect sizes for run metrics  (/stats <run_ids> <metric> [baseline_run_ids])',
  },
  {
    name: '/draft-section',
    desc: 'co-write a paper section from claims and notes  (/draft-section <section>)',
  },
  { name: '/fix-paper', desc: 'compile and auto-fix LaTeX errors (up to 3 rounds)' },
  {
    name: '/preview-figure',
    desc: 'render a figure or PDF page inline in the terminal  (/preview-figure <path>)',
  },
  { name: '/verify-comparisons', desc: 'check comparison claims against run data' },
  { name: '/reproduce', desc: 'print repro.sh for a run  (/reproduce <run_id>)' },
  { name: '/rerun', desc: 're-run and compare metrics  (/rerun <run_id>)' },
  { name: '/compare-runs', desc: 'diff two runs’ metrics and code  (/compare-runs <a> <b>)' },
  { name: '/promote-run', desc: 'mark a run canonical  (/promote-run <run_id>)' },
  {
    name: '/handoff',
    desc: 'generate a transfer packet  (--for-me · --for-pi · --for-reviewer · --for-industry-partner)',
  },
  { name: '/resume', desc: 'restore the last session' },
  { name: '/clear', desc: 'reset the conversation' },
  { name: '/help', desc: 'show this help' },
  { name: '/quit', desc: 'exit handoff' },
];

/**
 * Commands matching the slash-menu prefix — only while the user is typing the
 * command word itself (a leading `/` and no arguments yet).
 */
export function matchCommands(input: string): Command[] {
  if (!input.startsWith('/') || input.trim().includes(' ')) return [];
  const prefix = input.trim().split(/\s+/)[0] ?? '';
  return COMMANDS.filter((c) => c.name.startsWith(prefix));
}
