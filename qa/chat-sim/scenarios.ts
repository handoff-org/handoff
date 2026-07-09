import { writeFileSync, mkdirSync, appendFileSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { createProject } from '../../src/workspace/project.js';
import { claimsPath } from '../../src/workspace/claims.js';
import * as A from './assertions.js';
import type { MockStep, Scenario, ScenarioTurn } from './types.js';

// ── Turn / step builders ──────────────────────────────────────────────────────

const say = (text: string): MockStep => ({ kind: 'text', text });
const callTool = (name: string, args: Record<string, unknown>, text?: string): MockStep => ({
  kind: 'tools',
  calls: [{ name, args }],
  ...(text ? { text } : {}),
});
const chat = (text: string, steps?: MockStep[]): ScenarioTurn =>
  steps ? { type: 'chat', text, steps } : { type: 'chat', text };
const cmd = (command: string): ScenarioTurn => ({ type: 'command', command });

const handoffDir = (): string => join(homedir(), '.handoff');

// ── Named scenarios ─────────────────────────────────────────────────────────

const scenarios: Scenario[] = [
  {
    id: 'first-launch',
    name: 'First launch: greeting, help, model, settings, quit',
    smoke: true,
    turns: [
      chat('hello', [say('Hi! How can I help with your research?')]),
      cmd('/help'),
      cmd('/model'),
      cmd('/settings'),
      cmd('/quit'),
    ],
    check: (api) => [
      A.noErrors(api),
      A.check(
        'help lists /project',
        api.assistantTexts().some((t) => t.includes('/project')),
      ),
      A.check(
        'settings shows backend',
        api.assistantTexts().some((t) => t.includes('backend')),
      ),
    ],
  },

  {
    id: 'project-basics',
    name: 'Create a project and write a notes file',
    smoke: true,
    turns: [
      cmd('/project new Memory and Attention'),
      chat('What project is open?', [
        callTool('project_status', {}),
        say('Memory and Attention is open.'),
      ]),
      chat('Create a notes file with the research question.', [
        callTool('write_file', {
          path: 'literature/notes.md',
          content: '# RQ\nDo transformers need positional encodings?\n',
        }),
        say('Wrote literature/notes.md.'),
      ]),
    ],
    snapshot: ['literature/notes.md'],
    check: (api) => [
      A.noErrors(api),
      A.check('active project set', api.activeProjectSlug() != null),
      A.fileExists(api, 'literature/notes.md'),
      A.fileContains(api, 'literature/notes.md', 'positional encodings'),
    ],
  },

  {
    id: 'modes',
    name: 'Toggle permission mode and view settings',
    smoke: true,
    turns: [cmd('/mode off'), cmd('/settings'), cmd('/mode on'), cmd('/settings')],
    check: (api) => [
      A.noErrors(api),
      A.check(
        'mode reported',
        api.assistantTexts().some((t) => t.includes('mode')),
      ),
    ],
  },

  {
    id: 'paper-start',
    name: 'Start a paper (ask_user → template → start_paper)',
    smoke: true,
    turns: [
      cmd('/project new Test Paper'),
      chat('Start the paper.', [
        callTool('ask_user', { question: 'Which template?', options: ['blank', 'acl', 'neurips'] }),
        callTool('start_paper', { template: 'blank' }),
        say('Created the paper from the blank template.'),
      ]),
    ],
    askUser: (_q, opts) => opts[0] ?? 'blank',
    snapshot: ['paper/main.tex', 'paper/refs.bib'],
    check: (api) => [
      A.noErrors(api),
      A.fileExists(api, 'paper/main.tex'),
      A.fileExists(api, 'paper/refs.bib'),
      A.fileContains(api, 'paper/main.tex', '\\documentclass'),
      A.fileContains(api, 'paper/main.tex', '\\bibliographystyle'),
      A.fileContains(api, 'paper/main.tex', '\\bibliography'),
    ],
  },

  {
    id: 'paper-edit',
    name: 'Edit the existing main.tex, not a new file',
    smoke: true,
    turns: [
      cmd('/project new Edit Paper'),
      chat('Start the paper.', [callTool('start_paper', { template: 'blank' }), say('Done.')]),
      chat('Add a short introduction paragraph.', [
        callTool('edit_file', {
          path: 'paper/main.tex',
          old_string: '\\section{Introduction}',
          new_string: '\\section{Introduction}\nPositional encodings matter here.',
        }),
        say('Added an introduction.'),
      ]),
    ],
    snapshot: ['paper/main.tex'],
    check: (api) => [
      A.noErrors(api),
      A.fileContains(api, 'paper/main.tex', 'Positional encodings matter here.'),
      A.fileContains(api, 'paper/main.tex', '\\bibliography'),
      A.check(
        'no stray extra .tex file created',
        !api.fileExists('paper/intro.tex') && !api.fileExists('intro.tex'),
      ),
    ],
  },

  {
    id: 'cite-paper',
    name: 'Cite a cached paper into the bibliography',
    smoke: true,
    setup: () => {
      const dir = join(handoffDir(), 'research', 'papers');
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, 'W1.json'),
        JSON.stringify({
          id: 'W1',
          title: 'Attention Is All You Need',
          year: 2017,
          venue: 'NeurIPS',
          citations: 100,
          doi: '10.5555/attn',
          oaUrl: '',
          authors: ['Ashish Vaswani'],
          abstract: 'Transformer.',
        }),
      );
    },
    turns: [
      cmd('/project new Cite Demo'),
      chat('Start the paper.', [callTool('start_paper', { template: 'blank' }), say('Done.')]),
      chat('Cite the attention paper.', [
        callTool('cite_paper', { id: 'W1' }),
        say('Added the citation.'),
      ]),
    ],
    snapshot: ['paper/refs.bib'],
    check: (api) => [
      A.noErrors(api),
      A.fileContains(api, 'paper/refs.bib', 'vaswani2017attention'),
      A.check(
        'cite_paper returned a \\cite{} command',
        api.toolResults('cite_paper').some((r) => (r.output ?? '').includes('\\cite{')),
      ),
    ],
  },

  {
    id: 'research-offline',
    name: 'Research tool with no network fails gracefully',
    smoke: true,
    setup: () => {
      // Simulate no internet: every fetch rejects.
      (globalThis as unknown as { fetch: unknown }).fetch = () =>
        Promise.reject(new Error('ENOTFOUND (simulated offline)'));
    },
    turns: [
      cmd('/project new Offline'),
      chat('Search for papers on transformers.', [
        callTool('search_papers', { query: 'transformers positional encodings' }),
        say('The literature search could not reach the network.'),
      ]),
    ],
    check: (api) => [
      A.noErrors(api), // registry.call catches — no uncaught error event
      A.check(
        'search_papers failed gracefully with a message',
        api.toolResults('search_papers').some((r) => !r.ok && !!r.output),
      ),
    ],
  },

  {
    id: 'malformed-tool',
    name: 'Malformed tool-call JSON is handled, not crashed',
    smoke: true,
    turns: [
      cmd('/project new Malformed'),
      chat('Write a file.', [
        { kind: 'malformed_tool', name: 'write_file', rawArgs: '{ "path": "x.md", conten' },
        say('Recovered.'),
      ]),
    ],
    check: (api) => [
      A.noErrors(api),
      A.check(
        'a tool_result was produced for the malformed call',
        api.toolResults('write_file').length >= 1,
      ),
      A.check('assistant continued after the bad call', api.assistantTexts().length >= 1),
    ],
  },

  {
    id: 'duplicate-tool',
    name: 'Duplicate identical tool calls are de-duplicated',
    smoke: true,
    turns: [
      cmd('/project new Dedup'),
      chat('Write the same file twice.', [
        {
          kind: 'duplicate_tool',
          call: { name: 'write_file', args: { path: 'literature/dup.md', content: 'once' } },
        },
        say('Done.'),
      ]),
    ],
    check: (api) => [
      A.noErrors(api),
      A.check('duplicate collapsed to a single write', api.toolResults('write_file').length === 1, {
        actual: api.toolResults('write_file').length,
      }),
      A.fileExists(api, 'literature/dup.md'),
    ],
  },

  {
    id: 'shell-success',
    name: 'run_shell executes a simple command',
    smoke: true,
    turns: [
      cmd('/project new Shell OK'),
      chat('Run echo.', [callTool('run_shell', { command: 'echo qa-marker-123' }), say('Ran it.')]),
    ],
    check: (api) => [
      A.noErrors(api),
      A.check(
        'shell output captured',
        api.toolResults('run_shell').some((r) => (r.output ?? '').includes('qa-marker-123')),
      ),
    ],
  },

  {
    id: 'shell-failure',
    name: 'A failing shell command is handled gracefully',
    smoke: true,
    turns: [
      cmd('/project new Shell Fail'),
      chat('Run a failing command.', [
        callTool('run_shell', { command: 'this-command-does-not-exist-qa-xyz' }),
        say('That command failed; here is what happened.'),
      ]),
    ],
    check: (api) => [
      A.noErrors(api),
      A.check('a shell tool_result was produced', api.toolResults('run_shell').length >= 1),
    ],
  },

  {
    id: 'path-safety',
    name: 'Writing outside the workspace must not escape it',
    smoke: true,
    turns: [
      cmd('/project new Path Safety'),
      chat('Write a file above the project.', [
        callTool('write_file', { path: '../../../../outside-qa.txt', content: 'escape attempt' }),
        say('Attempted.'),
      ]),
    ],
    check: (api) => {
      // The escape must not land anywhere outside the isolated HOME, and ideally
      // not outside the project either. Check the obvious escape targets.
      const badTargets = [
        join(api.homeDir, 'outside-qa.txt'),
        join(api.homeDir, '..', 'outside-qa.txt'),
        join(handoffDir(), 'outside-qa.txt'),
        join(handoffDir(), 'projects', 'outside-qa.txt'),
      ];
      const escaped = badTargets.filter((t) => api.fileExists(t));
      return [
        A.check('no file written outside the project workspace', escaped.length === 0, {
          actual: escaped,
          notes: 'write_file resolved a ../ path outside the active project',
        }),
      ];
    },
  },

  {
    id: 'settings-persistence',
    name: 'A settings change persists across a reload',
    smoke: true,
    turns: [cmd('/config-set ollamaNumCtx 8192'), cmd('/settings')],
    check: (api) => [
      A.noErrors(api),
      A.check(
        'context persisted to 8192',
        api.assistantTexts().some((t) => t.includes('8192')),
      ),
    ],
  },

  {
    id: 'model-picker',
    name: 'Model selection edge cases do not crash',
    smoke: true,
    turns: [cmd('/model'), cmd('/model definitely-not-installed:999b'), cmd('/model')],
    check: (api) => [
      A.noErrors(api),
      A.check(
        'model change reflected',
        api.assistantTexts().some((t) => t.includes('definitely-not-installed')),
      ),
    ],
  },

  {
    id: 'laptop-perf',
    name: 'Small context value is accepted and valid',
    smoke: true,
    turns: [cmd('/config-set ollamaNumCtx 1024'), cmd('/settings')],
    check: (api) => [
      A.noErrors(api),
      A.check(
        'context is a small valid value',
        api.assistantTexts().some((t) => t.includes('1024')),
      ),
    ],
  },

  {
    id: 'personalization',
    name: 'Personalization profile show / disable / enable',
    smoke: true,
    turns: [
      chat('I prefer short, implementation-focused answers.', [
        say('Noted — I will keep answers concise.'),
      ]),
      cmd('/profile show'),
      cmd('/profile disable'),
      cmd('/profile enable'),
    ],
    check: (api) => [A.noErrors(api)],
  },

  {
    id: 'claims',
    name: 'Claims workflow: add, list, unsupported',
    smoke: true,
    turns: [
      cmd('/project new Claims Demo'),
      cmd('/claim-add Our method improves accuracy by 10%.'),
      cmd('/claims'),
      cmd('/unsupported'),
    ],
    check: (api) => [
      A.noErrors(api),
      A.check(
        'claims.jsonl exists',
        api.fileExists(
          join(handoffDir(), 'projects', api.activeProjectSlug() ?? '_', 'claims', 'claims.jsonl'),
        ),
      ),
      A.check(
        'unsupported claim shown',
        api
          .assistantTexts()
          .some((t) => t.toLowerCase().includes('accuracy') || t.includes('improves')),
      ),
    ],
  },

  {
    id: 'handoff-packet',
    name: 'Handoff packet on an empty project',
    smoke: true,
    turns: [cmd('/project new Handoff Demo'), cmd('/handoff --for-me')],
    check: (api) => [
      A.noErrors(api),
      A.check(
        'packet produced',
        api.assistantTexts().some((t) => t.includes('Handoff packet')),
      ),
    ],
  },

  {
    id: 'corrupt-state',
    name: 'Corrupt config / claims / profile recover gracefully',
    smoke: true,
    config: { __rawConfig: true }, // do not let the harness overwrite our corrupt config
    setup: () => {
      const meta = createProject({ title: 'Corrupt State' });
      writeFileSync(join(handoffDir(), 'config.json'), '{ this is not valid json', 'utf-8');
      mkdirSync(dirname(claimsPath(meta.slug)), { recursive: true });
      appendFileSync(claimsPath(meta.slug), 'not-a-json-line\n', 'utf-8');
      writeFileSync(join(handoffDir(), 'profile.json'), '{{{ broken', 'utf-8');
    },
    turns: [cmd('/settings'), cmd('/claims'), cmd('/profile show')],
    check: (api) => [
      A.noErrors(api),
      A.check(
        'settings still renders (config recovered to defaults)',
        api.assistantTexts().some((t) => t.includes('backend')),
      ),
    ],
  },

  {
    id: 'interrupt',
    name: 'Interrupting a slow stream stops it and recovers',
    smoke: true,
    turns: [
      cmd('/project new Interrupt'),
      {
        type: 'chat',
        text: 'Give me a very long answer.',
        steps: [
          {
            kind: 'slow',
            text: 'one two three four five six seven eight nine ten',
            chunkDelayMs: 40,
          },
        ],
        interruptAfterMs: 60,
      },
      chat('Are you still there?', [say('Yes, ready for the next request.')]),
    ],
    check: (api) => [
      A.check(
        'the interrupted stream was cancelled',
        api.events.some((e) => e.kind === 'app_event' && e.appEvent?.type === 'cancelled'),
      ),
      A.check(
        'a later turn still works',
        api.assistantTexts().some((t) => t.includes('ready for the next request')),
      ),
    ],
  },

  {
    id: 'long-input',
    name: 'Very long input with a code block and slash-like text',
    smoke: true,
    turns: [
      chat(
        'Here is a long message. ' +
          'x'.repeat(4000) +
          '\n```python\nprint("/not a command")\n```\nAlso /this-is-not-a-real-command in prose.',
        [say('Got it.')],
      ),
    ],
    check: (api) => [
      A.noErrors(api),
      A.check('assistant replied', api.assistantTexts().length >= 1),
    ],
  },

  {
    id: 'user-mistakes',
    name: 'Random user mistakes: bad commands and missing prerequisites',
    smoke: true,
    turns: [
      cmd('/project'),
      cmd('/model asdf'),
      cmd('/unknown'),
      cmd('/skill missing'),
      cmd('/overleaf'),
    ],
    check: (api) => [
      A.noErrors(api),
      A.check(
        'unknown command handled',
        api.assistantTexts().some((t) => t.includes('Unknown command')),
      ),
      A.check(
        'missing skill handled',
        api.assistantTexts().some((t) => t.toLowerCase().includes('no such skill')),
      ),
    ],
  },
];

// ── Randomized fuzz scenario ────────────────────────────────────────────────

/** Small seeded PRNG (mulberry32) for reproducible fuzz runs. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FUZZ_POOL: ((rnd: () => number) => ScenarioTurn)[] = [
  () => chat('hello', [say('Hi.')]),
  () => cmd('/help'),
  (r) => cmd(`/project new Fuzz ${Math.floor(r() * 1000)}`),
  () =>
    chat('Write a note.', [
      callTool('write_file', { path: 'literature/n.md', content: 'note' }),
      say('ok'),
    ]),
  () => chat('Read the notebook.', [callTool('read_file', { path: 'NOTEBOOK.md' }), say('ok')]),
  () => cmd('/claims'),
  () => cmd('/handoff --for-me'),
  () => cmd('/settings'),
  () => cmd('/model'),
  () => chat('thanks', [say('You are welcome.')]),
  () => cmd('/unknown-command'),
  () => chat('Start the paper.', [callTool('start_paper', { template: 'blank' }), say('done')]),
  () => chat('Run echo.', [callTool('run_shell', { command: 'echo fuzz' }), say('ok')]),
  () =>
    chat('Break it.', [{ kind: 'malformed_tool', name: 'write_file', rawArgs: '{bad' }, say('ok')]),
];

export function fuzzScenario(iterations: number): Scenario {
  return {
    id: 'fuzz',
    name: 'Randomized user session (seeded)',
    build: (ctx) => {
      const rnd = mulberry32(ctx.seed);
      const turns: ScenarioTurn[] = [cmd(`/project new Fuzz Session ${ctx.seed}`)];
      const n = Math.max(1, iterations);
      for (let i = 0; i < n; i++) {
        const pick = FUZZ_POOL[Math.floor(rnd() * FUZZ_POOL.length)]!;
        turns.push(pick(rnd));
      }
      return turns;
    },
    check: (api) => [A.noErrors(api)],
  };
}

export function allScenarios(): Scenario[] {
  return scenarios;
}

export function smokeScenarios(): Scenario[] {
  return scenarios.filter((s) => s.smoke);
}

export function scenarioById(id: string): Scenario | undefined {
  return scenarios.find((s) => s.id === id);
}
