import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { Box, Text, useInput, useApp, useStdin, useStdout } from 'ink';
import { spawnSync } from 'child_process';
import { writeFileSync, readFileSync, unlinkSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { basename, join } from 'path';
import { type ChatEntry } from './types.js';
import { bannerLines, LEFT_INNER, CANVAS_H } from './Banner.js';
import { useLogoAnimation } from './useLogoAnimation.js';
import { themePalette } from './ascii/gradient.js';
import { Overlays, type OverlayMode, type PendingQuestion } from './Overlays.js';
import {
  sanitizeTyped,
  classifyEnter,
  isCompleteEscapeSeq,
  caretRowCol,
  killToStart,
  killToEnd,
  deleteWordBack,
  pushHistory,
  HistoryCursor,
} from './input.js';
import { matchCommands } from './commands.js';
import { useTerminalSize } from './useTerminalSize.js';
import { entryLines, assistantLines } from './lines.js';
import { summarizeDiff } from './diff.js';
import { inkControl } from './inkControl.js';
import { runAgentLoop } from '../src/agent/loop.js';
import { buildSystem } from '../src/agent/systemPrompt.js';
import { writeTargetsProject } from '../src/agent/approval.js';
import { redactSecrets } from '../src/util/redact.js';
import { createModel, fetchVllmModels, type Message, type ChatModel } from '../src/agent/model.js';
import { isModelInstalled, listInstalledModels, ollamaPs, psRowFor } from '../src/agent/ollama.js';
import { detectHardware } from '../src/system/hardware.js';
import {
  advise,
  defaultContextForHardware,
  type PerformanceMode,
  type BenchmarkRecord,
} from '../src/agent/advisor.js';
import { buildDoctorReport } from '../src/agent/doctor.js';
import { benchmarkModel, loadBenchmarks, saveBenchmark } from '../src/agent/benchmark.js';
import { applyPreset, PRESET_LABELS, type InferencePreset } from '../src/agent/presets.js';
import { estimateMessagesTokens, promptBudgetFor, assessTurn } from '../src/agent/contextBudget.js';
import { findCatalogEntry } from '../config/catalog.js';
import {
  loadProfile,
  saveProfile,
  resetProfile,
  exportProfile,
  PROFILE_PATH,
} from '../src/personalization/store.js';
import {
  formatProfileSummary,
  explainPreference,
  type AdaptiveProfile,
} from '../src/personalization/profile.js';
import { buildPersonalizationPrompt } from '../src/personalization/prompt.js';
import {
  detectExplicitPreference,
  applyExplicit,
  recordEvent,
  forgetPreference,
  type PersonalizationEvent,
} from '../src/personalization/learn.js';
import { sanitizePreference } from '../src/personalization/redaction.js';
import { correctionsDirective } from '../src/research/corrections.js';
import { SKILL_TEMPLATE, saveUserSkill, loadSkills, findSkill } from '../src/skills/store.js';
import { withQuant, type Backend, type FavouriteEntry } from '../config/models.js';
import { getTheme } from '../config/theme.js';
import { writeStore } from '../config/store.js';
import {
  classifyTurn,
  resolveModel,
  formatTierNote,
  shouldShowTierNote,
} from '../src/agent/router.js';
import type { RouterContext } from '../src/agent/router.js';
import { INPUT_MODES_ON, INPUT_MODES_OFF } from './terminalControl.js';
import { makeCoalescer } from './streamThrottle.js';
import { saveSession, loadLastSession } from '../config/sessions.js';
import {
  loadProject,
  createProject,
  deleteProject,
  getActiveProject,
  setActiveProject as persistActiveProject,
  resolveWorkspacePath,
  projectPaths,
  slugify as slugifyProject,
  type ProjectMeta,
} from '../src/workspace/project.js';
import { initPaper } from '../src/workspace/paper.js';
import { generateHandoffPacket, parseHandoffFlags } from '../src/workspace/handoff.js';
import {
  readClaims,
  appendClaim,
  updateClaim,
  newClaimId,
  formatClaimsSummary,
  formatClaimDetail,
} from '../src/workspace/claims.js';
import { auditPaper, formatAuditReport } from '../src/workspace/auditor.js';
import {
  checkProvenance,
  applyProvenanceVerdicts,
  formatProvenanceReport,
} from '../src/workspace/provenance.js';
import { executeRun } from '../src/workspace/runner.js';
import {
  readCapsule,
  promoteRun,
  formatCompare,
  formatReproPreview,
} from '../src/workspace/capsule.js';
import {
  linkOverleaf,
  isOverleafLinked,
  overleafStatus,
  autoSyncOverleaf,
  autoPullOverleaf,
} from '../src/workspace/overleaf.js';
import type { Config } from '../config/schema.js';
import type { ToolRegistry } from '../src/tools/registry.js';

interface Props {
  initialConfig: Config;
  registry: ToolRegistry;
  autoResume?: boolean;
}

interface Pending {
  name: string;
  args: string;
  resolve: (ok: boolean) => void;
}

// Blank lines between the transcript and the input box (clear separation).
const INPUT_GAP = 3;

// Braille spinner frames for the input-box prompt caret while working.
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

// Lines moved per arrow-key / wheel notch when scrolling the transcript.
const SCROLL_STEP = 3;

// Coalesce streaming deltas to ≤1 state update per this many ms (≈30fps) so a
// long response doesn't re-render + re-layout the transcript per token.
const STREAM_FLUSH_MS = 33;

/**
 * Renders the prompt buffer with a block caret at `cursor`. The character under
 * the caret is shown inverse (a solid block when the caret sits at end-of-line),
 * and it blinks via `cursorOn`. Multi-line input (Shift+Enter) renders one row
 * per line with the caret on whichever line it falls.
 */
function InputContent({
  value,
  cursor,
  cursorOn,
  accent,
}: {
  value: string;
  cursor: number;
  cursorOn: boolean;
  accent: string;
}) {
  if (value.length === 0) {
    return (
      <Box>
        <Text color={accent}>{cursorOn ? '█' : ' '}</Text>
        <Text dimColor>Send a message (/help for commands)</Text>
      </Box>
    );
  }
  const lines = value.split('\n');
  const { row: lineIdx, col: rem } = caretRowCol(value, cursor);
  return (
    <Box flexDirection="column">
      {lines.map((line, i) => {
        if (i !== lineIdx) {
          return (
            <Box key={i}>
              <Text>{line.length ? line : ' '}</Text>
            </Box>
          );
        }
        const under = line.slice(rem, rem + 1) || ' ';
        return (
          <Box key={i}>
            <Text>{line.slice(0, rem)}</Text>
            <Text color={accent} inverse={cursorOn}>
              {under}
            </Text>
            <Text>{line.slice(rem + 1)}</Text>
          </Box>
        );
      })}
    </Box>
  );
}

type Focus = 'research' | 'general';

export function App({ initialConfig, registry, autoResume = false }: Props) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const { setRawMode, isRawModeSupported } = useStdin();
  const { rows, columns } = useTerminalSize();
  const [config, setConfig] = useState<Config>(initialConfig);
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  // Work focus: 'general' drops project context for off-work, general tasks.
  const [focus, setFocusState] = useState<Focus>(initialConfig.focus);
  const [history, setHistory] = useState<Message[]>(() => [
    {
      role: 'system',
      content: buildSystem(
        initialConfig.systemPrompt,
        initialConfig.focus === 'general' ? null : getActiveProject(),
      ),
    },
  ]);
  const [input, setInput] = useState('');
  // Caret position within `input` (0..input.length). Drives left/right movement
  // and where typed text / newlines are inserted, so editing isn't append-only.
  const [cursor, setCursor] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [mode, setMode] = useState<OverlayMode>('chat');
  const [modelPickTarget, setModelPickTarget] = useState<'main' | 'router_fast' | 'router_think'>(
    'main',
  );
  const [pending, setPending] = useState<Pending | null>(null);
  const [activeProject, setActiveProjectState] = useState<ProjectMeta | null>(() =>
    getActiveProject(),
  );
  const [streaming, setStreaming] = useState<string | null>(null);
  // True while the model is inside a <think> block (reasoning, no visible text yet).
  const [reasoning, setReasoning] = useState(false);
  // Lines scrolled up from the bottom (0 = following the latest).
  const [scrollOffset, setScrollOffset] = useState(0);
  // Spinner animation frame, advanced on a timer while the model is working.
  const [tick, setTick] = useState(0);
  // Highlighted entry in the slash-command menu.
  const [menuIndex, setMenuIndex] = useState(0);
  // A model question waiting on the user's selection (ask_user tool).
  const [question, setQuestion] = useState<PendingQuestion | null>(null);
  // Models available from the vLLM server (fetched when backend = 'vllm').
  const [vllmModels, setVllmModels] = useState<string[]>([]);
  // Models available from llama.cpp / MLX servers.
  const [llamaCppModels, setLlamaCppModels] = useState<string[]>([]);
  const [mlxModels, setMlxModels] = useState<string[]>([]);
  // Installed Ollama models (fetched from ollama list when model picker opens).
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  // Model id being pulled in the 'model_prepare' overlay.
  const [pullModelId, setPullModelId] = useState<string>('');
  // Bumped to force a repaint after returning to chat from a full-screen overlay
  // (see the effect below). The value is otherwise unused.
  const [, setRepaintTick] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const lastTierRef = useRef<'fast' | 'think' | null>(null);
  const hadToolCallsRef = useRef(false);
  const forceTierRef = useRef<'fast' | 'think' | null>(null);
  // The tier last *announced* to the user, so a 'changes'-mode note only fires
  // when the tier actually switches (see shouldShowTierNote).
  const lastShownTierRef = useRef<'fast' | 'think' | null>(null);
  // Submitted-input history (oldest→newest) and the live browse cursor. The
  // cursor is created on the first Ctrl-P and cleared whenever the user edits
  // the box or submits, so browsing never fights with typing.
  const historyRef = useRef<string[]>([]);
  const historyCursorRef = useRef<HistoryCursor | null>(null);
  // Pre-write file contents, captured at tool_call time to render a diff after.
  const pendingWriteRef = useRef<{ path: string; oldText: string; newText: string } | null>(null);
  // Set when the model runs create_project this turn, so the app can pop the
  // template chooser once the turn ends (deterministic — not model-driven).
  const createdProjectRef = useRef(false);
  // Last per-turn perf note shown, so we don't repeat the same advice every turn.
  const lastPerfNoteRef = useRef<string>('');
  // The local adaptive profile (personalization). Loaded once; mutated in place
  // as the user states preferences or exhibits habits, then persisted best-effort.
  const profileRef = useRef<AdaptiveProfile>(loadProfile());
  // The rendered "User preferences" prompt block, recomputed when the profile or
  // the relevant config toggles change; folded into promptOpts below.
  const [personalizationBlock, setPersonalizationBlock] = useState('');
  // The project awaiting a template pick in the 'template_select' overlay.
  const [templateTarget, setTemplateTarget] = useState<ProjectMeta | null>(null);

  // Input/scroll modes for the live TUI. Alt-scroll (?1007h) lets the mouse
  // wheel scroll the transcript — terminals translate wheel events into arrow
  // keys in the alt buffer, which the arrow handlers below already handle —
  // without capturing the mouse, so click-drag text selection / copy-paste keep
  // working. Bracketed paste is disabled (?2004l) so pasted URLs/tokens arrive
  // as plain text instead of ESC[200~…ESC[201~ markers (which corrupt the value
  // or get misread as an Escape keypress).
  //
  // The alternate screen buffer (?1049h/l) is deliberately NOT touched here —
  // src/index.tsx is its sole owner (see ui/terminalControl.ts) so the post-quit
  // recap can print on the normal screen and it's never popped twice.
  useEffect(() => {
    process.stdout.write(INPUT_MODES_ON);
    const restore = () => process.stdout.write(INPUT_MODES_OFF);
    process.on('exit', restore);
    return () => {
      restore();
      process.off('exit', restore);
    };
  }, []);

  // Animate the spinner only while the model is working.
  useEffect(() => {
    if (!isLoading) {
      setTick(0);
      return;
    }
    const id = setInterval(() => setTick((t) => t + 1), 90);
    return () => clearInterval(id);
  }, [isLoading]);

  // Blinking block cursor for the input box — a terminal-style caret. It blinks
  // only while the input is active (chat mode, not working); steady-off while the
  // model responds (the spinner is the prompt then). Honors reduced-motion.
  const [cursorOn, setCursorOn] = useState(true);
  useEffect(() => {
    if (isLoading || mode !== 'chat') {
      setCursorOn(false);
      return;
    }
    if (process.env['HANDOFF_REDUCED_MOTION'] != null) {
      setCursorOn(true); // steady block, no blink
      return;
    }
    setCursorOn(true);
    const id = setInterval(() => setCursorOn((c) => !c), 530);
    return () => clearInterval(id);
  }, [isLoading, mode]);

  // Repaint when returning to chat from a full-screen overlay. When an overlay
  // hands control back in a single input-triggered state change (e.g. picking a
  // model for MLX/vLLM/llama.cpp, which goes straight to chat with no async
  // progress screen), Ink's cached last-output already matches the new chat
  // frame, so it writes nothing and the terminal keeps showing the stale overlay
  // until the next keypress. Reset that cache and nudge one render so the chat
  // view appears immediately. Ollama sidesteps this via its model-prepare screen.
  const prevModeRef = useRef<OverlayMode>(mode);
  useEffect(() => {
    const returnedToChat = prevModeRef.current !== 'chat' && mode === 'chat';
    prevModeRef.current = mode;
    if (!returnedToChat) return;
    const id = setTimeout(() => {
      inkControl.clear(); // drop Ink's output cache so the next render fully repaints
      setRepaintTick((n) => n + 1); // schedule that render
    }, 0);
    return () => clearTimeout(id);
  }, [mode]);

  // Fetch available models from vLLM server whenever backend or URL changes.
  useEffect(() => {
    if (config.backend !== 'vllm') {
      setVllmModels([]);
      return;
    }
    fetchVllmModels(config.vllmBaseUrl)
      .then(setVllmModels)
      .catch(() => setVllmModels([]));
  }, [config.backend, config.vllmBaseUrl]);

  useEffect(() => {
    if (config.backend !== 'llama_cpp') {
      setLlamaCppModels([]);
      return;
    }
    fetchVllmModels(config.llamaCppBaseUrl)
      .then(setLlamaCppModels)
      .catch(() => setLlamaCppModels([]));
  }, [config.backend, config.llamaCppBaseUrl]);

  useEffect(() => {
    if (config.backend !== 'mlx') {
      setMlxModels([]);
      return;
    }
    fetchVllmModels(config.mlxBaseUrl)
      .then(setMlxModels)
      .catch(() => setMlxModels([]));
  }, [config.backend, config.mlxBaseUrl]);

  // Fetch installed Ollama models when the model picker opens.
  useEffect(() => {
    if (mode !== 'model_select' || config.backend !== 'ollama') return;
    listInstalledModels(config.ollamaBaseUrl)
      .then(setOllamaModels)
      .catch(() => setOllamaModels([]));
  }, [mode, config.backend, config.ollamaBaseUrl]);

  const theme = useMemo(() => getTheme(config.theme), [config.theme]);
  const model = useMemo(
    () => createModel(config),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      config.backend,
      config.modelId,
      config.hfToken,
      config.ollamaBaseUrl,
      config.vllmBaseUrl,
      config.llamaCppBaseUrl,
      config.mlxBaseUrl,
    ],
  );

  // Fast model: only created when routing is on and the fast id differs from main.
  const fastModel = useMemo(() => {
    if (!config.routerEnabled) return null;
    const fastId = config.routerFastModelId;
    if (!fastId || fastId === config.modelId) return null;
    return createModel({ ...config, modelId: fastId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    config.routerEnabled,
    config.routerFastModelId,
    config.modelId,
    config.backend,
    config.hfToken,
    config.ollamaBaseUrl,
    config.vllmBaseUrl,
    config.llamaCppBaseUrl,
    config.mlxBaseUrl,
  ]);

  // Think model: reuses existing `model` when IDs match (the common case).
  const thinkModel = useMemo(() => {
    if (!config.routerThinkModelId || config.routerThinkModelId === config.modelId) return model;
    return createModel({ ...config, modelId: config.routerThinkModelId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    model,
    config.routerThinkModelId,
    config.modelId,
    config.backend,
    config.hfToken,
    config.ollamaBaseUrl,
    config.vllmBaseUrl,
    config.llamaCppBaseUrl,
    config.mlxBaseUrl,
  ]);

  const addEntry = (entry: ChatEntry) => {
    setEntries((prev) => [...prev, entry]);
    setScrollOffset(0);
  };

  // Profile-aware prompt options: pick a compact prompt for cool mode / small
  // models, and inject the model-family hint the catalog knows about.
  const promptOpts = useMemo(() => {
    const entry = findCatalogEntry(config.backend, config.modelId);
    return {
      backend: config.backend,
      modelId: config.modelId,
      ...(entry ? { modelFamily: entry.family } : {}),
      performanceMode: config.modelPerformanceMode as PerformanceMode,
      focus,
      ...(personalizationBlock ? { personalization: personalizationBlock } : {}),
    };
  }, [config.backend, config.modelId, config.modelPerformanceMode, focus, personalizationBlock]);

  // Recompute the rendered personalization block from the current profile + config.
  const refreshPersonalizationBlock = useCallback(() => {
    const block = buildPersonalizationPrompt(profileRef.current, {
      enabled: config.personalizationEnabled,
      includeInPrompt: config.personalizationIncludeInPrompt,
      isCloudBackend: config.backend === 'hf',
      allowCloud: config.personalizationAllowCloudPrompt,
      focus,
    });
    setPersonalizationBlock(block);
  }, [
    config.personalizationEnabled,
    config.personalizationIncludeInPrompt,
    config.personalizationAllowCloudPrompt,
    config.backend,
    focus,
  ]);

  // Keep the block in sync with config/focus changes (and on mount).
  useEffect(() => {
    refreshPersonalizationBlock();
  }, [refreshPersonalizationBlock]);

  // Record a behavioural personalization event (best-effort, gated by config).
  const recordPersonalizationEvent = useCallback(
    (event: PersonalizationEvent) => {
      if (!config.personalizationEnabled) return;
      const perfEvents = new Set(['model_selected', 'model_benchmark']);
      if (perfEvents.has(event.type) && !config.personalizationLearnFromPerformance) return;
      const projEvents = new Set(['project_created', 'paper_template_selected']);
      if (projEvents.has(event.type) && !config.personalizationLearnFromProjects) return;
      profileRef.current = recordEvent(profileRef.current, event, new Date().toISOString());
      void saveProfile(profileRef.current);
      refreshPersonalizationBlock();
    },
    [
      config.personalizationEnabled,
      config.personalizationLearnFromPerformance,
      config.personalizationLearnFromProjects,
      refreshPersonalizationBlock,
    ],
  );

  const approve = useCallback(
    (name: string, args: string): Promise<boolean> => {
      // Hands-off (auto) means "don't prompt for in-project edits" — NOT "write
      // anywhere on the filesystem." A file write/dir create that escapes the
      // active project still prompts, even in auto, so a stray path can't clobber
      // files outside the workspace unattended.
      if (
        (name === 'write_file' || name === 'edit_file' || name === 'make_dir') &&
        !writeTargetsProject(args)
      ) {
        return new Promise<boolean>((res) => setPending({ name, args, resolve: res }));
      }
      if (config.mode === 'auto') return Promise.resolve(true);
      if (!registry.isSensitive(name)) return Promise.resolve(true);
      // The research loop writes files constantly; applying edits inside the
      // active project — and syncing the linked paper — shouldn't need a yes.
      if (
        (name === 'write_file' || name === 'edit_file' || name === 'make_dir') &&
        writeTargetsProject(args)
      ) {
        return Promise.resolve(true);
      }
      if (name === 'overleaf_push' || name === 'overleaf_sync') return Promise.resolve(true);
      return new Promise<boolean>((res) => setPending({ name, args, resolve: res }));
    },
    [config.mode, registry],
  );

  // Present a model's ask_user question on screen and resolve with the choice.
  const askUser = useCallback(
    (q: string, options: string[]): Promise<string> =>
      new Promise<string>((resolve) => setQuestion({ q, options, resolve })),
    [],
  );

  const resumeSession = useCallback(async () => {
    const s = await loadLastSession();
    if (!s) {
      addEntry({ kind: 'note', content: 'no saved session found' });
      return;
    }
    setHistory(s.history);
    setEntries((prev) => [
      ...prev,
      { kind: 'note', content: '— restored session —' },
      ...(s.entries as ChatEntry[]),
    ]);
    setScrollOffset(0);
  }, []);

  // Restore the last session immediately when launched with --resume.
  useEffect(() => {
    if (autoResume) void resumeSession();
  }, [autoResume, resumeSession]);

  // On startup, verify the configured Ollama model is actually installed.
  // If not, show the pull screen immediately instead of failing on the first message.
  useEffect(() => {
    if (initialConfig.backend !== 'ollama') return;
    void isModelInstalled(initialConfig.ollamaBaseUrl, initialConfig.modelId).then((ok) => {
      if (!ok) {
        setPullModelId(initialConfig.modelId);
        setMode('model_prepare');
      }
    });
  }, []); // run once on mount

  // Server-backed local backends (llama.cpp, MLX, vLLM) need a separate process
  // running in another terminal. On startup, probe it; if it's not reachable,
  // drop a one-time reminder into the chat with the endpoint + start command.
  useEffect(() => {
    const b = initialConfig.backend;
    if (b !== 'llama_cpp' && b !== 'mlx' && b !== 'vllm') return;
    const url =
      b === 'vllm'
        ? initialConfig.vllmBaseUrl
        : b === 'mlx'
          ? initialConfig.mlxBaseUrl
          : initialConfig.llamaCppBaseUrl;
    const start =
      b === 'vllm'
        ? `vllm serve ${initialConfig.modelId}`
        : b === 'mlx'
          ? `mlx_lm.server --model ${initialConfig.modelId} --port ${new URL(url).port || '8080'}`
          : `llama-server -m <model.gguf> --port ${new URL(url).port || '8080'}`;
    const label = b === 'llama_cpp' ? 'llama.cpp' : b === 'mlx' ? 'MLX' : 'vLLM';
    void fetchVllmModels(url)
      .then((models) => {
        if (models.length === 0) throw new Error('empty');
      })
      .catch(() => {
        addEntry({
          kind: 'note',
          content:
            `${label} backend selected → this needs a server running in another terminal.\n` +
            `Couldn't reach it at ${url}. Start it, e.g.:\n  ${start}\n` +
            `Then send your message (or switch backends with /model).`,
        });
      });
  }, []); // run once on mount

  // Persist the conversation, then exit — so the recap reflects everything.
  const quit = useCallback(() => {
    void saveSession(history, entries);
    exit();
  }, [history, entries, exit]);

  // Make a project active: persist it, update local state, and refresh the
  // system message so the model knows where to write.
  const switchProject = useCallback(
    (meta: ProjectMeta, note?: string) => {
      persistActiveProject(meta.slug);
      setActiveProjectState(meta);
      // Opening a project means you're working on it — leave off-work mode.
      setFocusState('research');
      void writeStore({ focus: 'research' });
      setHistory((h) => [
        { role: 'system', content: buildSystem(config.systemPrompt, meta, promptOpts) },
        ...h.slice(1),
      ]);
      addEntry({ kind: 'note', content: note ?? `project → ${meta.slug}` });
    },
    [config.systemPrompt],
  );

  // Toggle off-work (general) vs research focus. 'general' drops project
  // context from the system message so the agent acts as a general assistant.
  const setFocus = useCallback(
    (f: Focus) => {
      setFocusState(f);
      void writeStore({ focus: f });
      const meta = f === 'general' ? null : getActiveProject();
      setHistory((h) => [
        { role: 'system', content: buildSystem(config.systemPrompt, meta, promptOpts) },
        ...h.slice(1),
      ]);
      addEntry({
        kind: 'note',
        content:
          f === 'general'
            ? 'off-work — general assistant (project context paused)'
            : activeProject
              ? `back on the books — ${activeProject.title}`
              : 'research focus — open a project with /project',
      });
    },
    [config.systemPrompt, activeProject],
  );

  // Create a project and immediately switch to it (used by /project new + the menu).
  const createAndSwitch = useCallback(
    (title: string) => {
      try {
        const meta = createProject({ title });
        switchProject(
          meta,
          `created project "${meta.slug}" — literature/ experiments/ runs/ results/ paper/ ready`,
        );
      } catch (e) {
        addEntry({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
      }
    },
    [switchProject],
  );

  // Delete a project's files; if it was active, drop the active context too.
  const handleDeleteProject = useCallback(
    (slug: string) => {
      try {
        deleteProject(slug);
        addEntry({ kind: 'note', content: `deleted project "${slug}"` });
        if (activeProject?.slug === slug) {
          setActiveProjectState(null);
          setHistory((h) => [
            { role: 'system', content: buildSystem(config.systemPrompt, null, promptOpts) },
            ...h.slice(1),
          ]);
        }
      } catch (e) {
        addEntry({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
      }
    },
    [activeProject, config.systemPrompt],
  );

  // /project [new <name> | <slug>] — create, switch, or (no arg) open the menu.
  const handleProject = useCallback(
    (rest: string) => {
      const arg = rest.trim();
      if (/^new\b/i.test(arg)) {
        const name = arg.replace(/^new\s*/i, '').trim();
        if (!name) {
          addEntry({ kind: 'note', content: 'usage: /project new <name>' });
          return;
        }
        createAndSwitch(name);
        return;
      }
      if (arg) {
        const slug = slugifyProject(arg);
        const meta = loadProject(slug);
        if (!meta) {
          addEntry({
            kind: 'error',
            message: `no project "${slug}" — type /project to list yours`,
          });
          return;
        }
        switchProject(meta);
        return;
      }
      setMode('project_select');
    },
    [switchProject, createAndSwitch],
  );

  const onProjectPicked = useCallback(
    (slug: string) => {
      setMode('chat');
      const meta = loadProject(slug);
      if (meta) switchProject(meta);
    },
    [switchProject],
  );

  // Post-create template chooser: apply the picked template directly (no model
  // round-trip), refresh the paper context, and drop back to chat. '' = defer.
  const onTemplatePicked = useCallback(
    (templateKey: string) => {
      setMode('chat');
      const meta = templateTarget ?? getActiveProject();
      setTemplateTarget(null);
      if (!meta) return;
      if (!templateKey) {
        addEntry({
          kind: 'note',
          content: `no template chosen — set one up later with start_paper`,
        });
        return;
      }
      const res = initPaper(meta, templateKey);
      recordPersonalizationEvent({
        type: 'paper_template_selected',
        timestamp: new Date().toISOString(),
        summary: templateKey,
        metadata: { template: templateKey },
      });
      addEntry(
        res.ok ? { kind: 'note', content: res.message } : { kind: 'error', message: res.message },
      );
      // Refresh the system message so the model knows a paper now exists.
      setHistory((h) => [
        { role: 'system', content: buildSystem(config.systemPrompt, meta, promptOpts) },
        ...h.slice(1),
      ]);
    },
    [templateTarget, config.systemPrompt, promptOpts, recordPersonalizationEvent],
  );

  // /overleaf — open the paste-the-link form, or (if linked) show status + sync.
  const handleOverleaf = useCallback(() => {
    if (!getActiveProject()) {
      addEntry({ kind: 'note', content: 'create a project first: /project new <name>' });
      return;
    }
    if (isOverleafLinked()) {
      addEntry({ kind: 'note', content: overleafStatus() });
      const sync = autoSyncOverleaf();
      if (sync) addEntry({ kind: 'note', content: sync });
      return;
    }
    setMode('overleaf_link');
  }, []);

  const handleHandoff = useCallback((argStr: string) => {
    const meta = getActiveProject();
    if (!meta) {
      addEntry({
        kind: 'note',
        content: 'no active project — create one with /project new <name>',
      });
      return;
    }
    try {
      const opts = parseHandoffFlags(argStr);
      const { content, outputPath } = generateHandoffPacket(meta, opts);
      addEntry({ kind: 'note', content });
      addEntry({ kind: 'note', content: `saved → ${outputPath}` });
    } catch (e) {
      addEntry({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  /** Dispatcher for all /claim-* and /audit-paper commands. */
  const handleClaims = useCallback((cmd: string, argStr: string) => {
    const meta = getActiveProject();
    if (!meta) {
      addEntry({
        kind: 'note',
        content: 'no active project — create one with /project new <name>',
      });
      return;
    }
    const slug = meta.slug;
    try {
      if (cmd === '/audit-paper') {
        const result = auditPaper(slug);
        addEntry({ kind: 'note', content: formatAuditReport(result, meta.title) });
        return;
      }

      if (cmd === '/provenance') {
        const verdicts = checkProvenance(slug);
        applyProvenanceVerdicts(slug, verdicts);
        addEntry({ kind: 'note', content: formatProvenanceReport(verdicts, meta.title) });
        return;
      }

      if (cmd === '/claims') {
        const claims = readClaims(slug);
        addEntry({ kind: 'note', content: formatClaimsSummary(claims, meta.title) });
        return;
      }

      if (cmd === '/unsupported') {
        const claims = readClaims(slug).filter(
          (c) => c.status === 'unsupported' || c.status === 'weakly_supported',
        );
        if (claims.length === 0) {
          addEntry({ kind: 'note', content: 'No unsupported claims — great!' });
        } else {
          addEntry({
            kind: 'note',
            content: formatClaimsSummary(claims, `${meta.title} — unsupported`),
          });
        }
        return;
      }

      if (cmd === '/claim-add') {
        const text = argStr.trim().replace(/^["']|["']$/g, '');
        if (!text) {
          addEntry({ kind: 'note', content: 'usage: /claim-add <claim text>' });
          return;
        }
        const now = new Date().toISOString();
        appendClaim(slug, {
          id: newClaimId(),
          text,
          type: 'unknown',
          status: 'unsupported',
          locations: [],
          evidence: [],
          risks: ['No linked evidence'],
          createdAt: now,
          updatedAt: now,
        });
        addEntry({ kind: 'note', content: `Claim added. Run /audit-paper to auto-detect more.` });
        return;
      }

      if (cmd === '/claim-status') {
        const id = argStr.trim();
        if (!id) {
          addEntry({ kind: 'note', content: 'usage: /claim-status <id>' });
          return;
        }
        const claim = readClaims(slug).find((c) => c.id === id);
        if (!claim) {
          addEntry({ kind: 'error', message: `No claim "${id}"` });
          return;
        }
        addEntry({ kind: 'note', content: formatClaimDetail(claim) });
        return;
      }

      if (cmd === '/claim-link-run') {
        const [id, runId] = argStr.trim().split(/\s+/);
        if (!id || !runId) {
          addEntry({ kind: 'note', content: 'usage: /claim-link-run <claim_id> <run_id>' });
          return;
        }
        const updated = updateClaim(slug, id, {
          status: 'weakly_supported',
          evidence: [
            ...(readClaims(slug).find((c) => c.id === id)?.evidence ?? []),
            { kind: 'run', ref: runId, addedAt: new Date().toISOString() },
          ],
          risks: [],
        });
        if (!updated) {
          addEntry({ kind: 'error', message: `No claim "${id}"` });
          return;
        }
        addEntry({
          kind: 'note',
          content: `Linked run ${runId} → claim ${id} (status: weakly_supported)\nRun /claim-status ${id} to review, then set supported with /claim-link-run if evidence is strong.`,
        });
        return;
      }

      if (cmd === '/claim-link-paper') {
        const [id, citKey] = argStr.trim().split(/\s+/);
        if (!id || !citKey) {
          addEntry({ kind: 'note', content: 'usage: /claim-link-paper <claim_id> <citation_key>' });
          return;
        }
        const updated = updateClaim(slug, id, {
          status: 'weakly_supported',
          evidence: [
            ...(readClaims(slug).find((c) => c.id === id)?.evidence ?? []),
            { kind: 'paper', ref: citKey, addedAt: new Date().toISOString() },
          ],
          risks: [],
        });
        if (!updated) {
          addEntry({ kind: 'error', message: `No claim "${id}"` });
          return;
        }
        addEntry({
          kind: 'note',
          content: `Linked citation ${citKey} → claim ${id} (status: weakly_supported)`,
        });
        return;
      }
    } catch (e) {
      addEntry({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  /** Dispatcher for the run-capsule commands: /reproduce /rerun /compare-runs /promote-run. */
  const handleCapsules = useCallback((cmd: string, argStr: string) => {
    const meta = getActiveProject();
    if (!meta) {
      addEntry({
        kind: 'note',
        content: 'no active project — create one with /project new <name>',
      });
      return;
    }
    const slug = meta.slug;
    const args = argStr.trim().split(/\s+/).filter(Boolean);
    try {
      if (cmd === '/reproduce') {
        const id = args[0];
        if (!id) {
          addEntry({ kind: 'note', content: 'usage: /reproduce <run_id>' });
          return;
        }
        const c = readCapsule(slug, id);
        if (!c) {
          addEntry({
            kind: 'error',
            message: `No run "${id}" — see the runs/ folder or query_runs`,
          });
          return;
        }
        addEntry({ kind: 'note', content: formatReproPreview(slug, c) });
        return;
      }
      if (cmd === '/rerun') {
        const id = args[0];
        if (!id) {
          addEntry({ kind: 'note', content: 'usage: /rerun <run_id>' });
          return;
        }
        const c = readCapsule(slug, id);
        if (!c) {
          addEntry({ kind: 'error', message: `No run "${id}"` });
          return;
        }
        addEntry({ kind: 'note', content: `re-running ${id} (${c.language})…` });
        const res = executeRun(slug, {
          language: c.language as 'python' | 'r' | 'julia' | 'shell',
          code: c.code,
          description: `rerun of ${id}`,
        });
        const fresh = readCapsule(slug, res.capsuleId);
        addEntry({
          kind: 'note',
          content: fresh
            ? formatCompare(c, fresh)
            : `reran → ${res.capsuleId} · exit ${res.exitCode}`,
        });
        return;
      }
      if (cmd === '/compare-runs') {
        const [a, b] = args;
        if (!a || !b) {
          addEntry({ kind: 'note', content: 'usage: /compare-runs <id_a> <id_b>' });
          return;
        }
        const ca = readCapsule(slug, a);
        const cb = readCapsule(slug, b);
        if (!ca || !cb) {
          addEntry({
            kind: 'error',
            message: `Unknown run(s): ${[!ca && a, !cb && b].filter(Boolean).join(', ')}`,
          });
          return;
        }
        addEntry({ kind: 'note', content: formatCompare(ca, cb) });
        return;
      }
      if (cmd === '/promote-run') {
        const id = args[0];
        if (!id) {
          addEntry({ kind: 'note', content: 'usage: /promote-run <run_id>' });
          return;
        }
        addEntry(
          promoteRun(slug, id)
            ? { kind: 'note', content: `Promoted ${id} as a canonical run.` }
            : { kind: 'error', message: `No run "${id}"` },
        );
        return;
      }
    } catch (e) {
      addEntry({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  const onOverleafLink = useCallback(
    (url: string, token: string) => {
      setMode('chat');
      try {
        addEntry({ kind: 'note', content: linkOverleaf(url, token) });
        const meta = getActiveProject();
        if (meta) {
          setActiveProjectState(meta); // refresh banner (paperMode changed)
          // Refresh the system message so the model gets the main-file rule now.
          setHistory((h) => [
            { role: 'system', content: buildSystem(config.systemPrompt, meta, promptOpts) },
            ...h.slice(1),
          ]);
        }
      } catch (e) {
        addEntry({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
      }
    },
    [config.systemPrompt],
  );

  // Build a diagnostic report for `/model doctor` and show it as a note.
  const runModelDoctor = useCallback(async () => {
    const hardware = detectHardware();
    const mode = config.modelPerformanceMode as PerformanceMode;
    const installedModels =
      config.backend === 'ollama' ? await listInstalledModels(config.ollamaBaseUrl) : undefined;
    const psRows = config.backend === 'ollama' ? ollamaPs() : undefined;
    const benchmarks = (await loadBenchmarks(
      config.modelBenchmarkCachePath,
    )) as unknown as BenchmarkRecord[];
    const advice = advise({
      hardware,
      backend: config.backend,
      performanceMode: mode,
      currentModelId: config.modelId,
      currentContextTokens: config.ollamaNumCtx,
      ...(installedModels ? { installedModels } : {}),
      benchmarks,
      cloudConsent: config.hfConsent,
    });
    const report = buildDoctorReport({
      backend: config.backend,
      modelId: config.modelId,
      contextTokens: config.ollamaNumCtx,
      keepAlive: config.ollamaKeepAlive,
      flashAttention: config.ollamaFlashAttention,
      kvCacheType: config.ollamaKvCacheType,
      performanceMode: mode,
      hardware,
      ...(installedModels ? { installedModels } : {}),
      ...(psRows ? { psRows } : {}),
      benchmarks,
      advice,
    });
    addEntry({ kind: 'note', content: report });
  }, [config]);

  // Benchmark the current model with synthetic prompts only (no project data).
  const runModelBenchmark = useCallback(
    async (opts?: { quick?: boolean; modelId?: string }) => {
      const targetId = opts?.modelId ?? config.modelId;
      // Benchmark a different model than the active one by cloning config for it.
      const benchModel =
        targetId === config.modelId ? model : createModel({ ...config, modelId: targetId });
      const kind = opts?.quick ? 'quick, no tool-call test' : 'synthetic prompts, no project data';
      addEntry({ kind: 'note', content: `Benchmarking ${targetId} (${kind})…` });
      try {
        const result = await benchmarkModel({
          model: benchModel,
          backend: config.backend,
          modelId: targetId,
          quant: findCatalogEntry(config.backend, targetId)?.defaultQuant ?? 'default',
          contextTokens: config.ollamaNumCtx,
          now: Date.now(),
          handoffVersion: 'dev',
          toolCallTest: !opts?.quick,
        });
        await saveBenchmark(result, config.modelBenchmarkCachePath);
        recordPersonalizationEvent({
          type: 'model_benchmark',
          timestamp: new Date().toISOString(),
          summary: `${targetId} ${result.tier}`,
          metadata: { modelId: targetId, tier: result.tier, fullGpu: result.fullGpu },
        });
        const spill = result.fullGpu ? '' : ' · CPU spill';
        const tool = opts?.quick
          ? ''
          : ` · ${result.toolCallOk ? 'tool-call ok' : 'tool-call FAILED'}`;
        addEntry({
          kind: 'note',
          content:
            `Benchmark: ${result.tokensPerSec} tok/s (${result.tier})${spill}${tool}` +
            (result.ttftMs != null ? ` · ${result.ttftMs}ms to first token` : '') +
            (result.error ? `\n  error: ${result.error}` : ''),
        });
      } catch (e) {
        addEntry({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
      }
    },
    [config, model, recordPersonalizationEvent],
  );

  const runCommand = useCallback(
    (raw: string): boolean => {
      const [cmd, ...rest] = raw.trim().toLowerCase().split(/\s+/);
      const arg = rest.join(' ');
      // Light habit signal: which slash commands the user leans on.
      if (cmd && cmd.startsWith('/')) {
        recordPersonalizationEvent({
          type: 'command_used',
          timestamp: new Date().toISOString(),
          summary: cmd,
          metadata: { command: cmd },
        });
      }
      if (cmd === '/quit' || cmd === '/exit') {
        quit();
        return true;
      }
      if (cmd === '/clear') {
        setHistory([
          {
            role: 'system',
            content: buildSystem(
              config.systemPrompt,
              focus === 'general' ? null : activeProject,
              promptOpts,
            ),
          },
        ]);
        addEntry({ kind: 'note', content: '— context cleared —' });
        return true;
      }
      if (cmd === '/help') {
        addEntry({ kind: 'help' });
        return true;
      }
      if (cmd === '/profile') {
        const [sub, ...subArgs] = arg.split(/\s+/).filter(Boolean);
        const key = subArgs.join(' ');
        if (!sub || sub === 'show') {
          addEntry({ kind: 'note', content: formatProfileSummary(profileRef.current) });
        } else if (sub === 'enable' || sub === 'disable') {
          const on = sub === 'enable';
          setConfig((c) => ({ ...c, personalizationEnabled: on }));
          void writeStore({ personalizationEnabled: on });
          addEntry({ kind: 'note', content: `personalization → ${on ? 'enabled' : 'disabled'}` });
        } else if (sub === 'reset') {
          if (key === 'yes') {
            profileRef.current = resetProfile();
            refreshPersonalizationBlock();
            addEntry({
              kind: 'note',
              content: 'personalization profile cleared (previous version backed up).',
            });
          } else {
            addEntry({
              kind: 'note',
              content:
                'this clears everything handoff has learned. confirm with: /profile reset yes',
            });
          }
        } else if (sub === 'forget') {
          if (!key)
            addEntry({
              kind: 'note',
              content: 'usage: /profile forget <key>  (see /profile show for keys)',
            });
          else {
            profileRef.current = forgetPreference(profileRef.current, key);
            void saveProfile(profileRef.current);
            refreshPersonalizationBlock();
            addEntry({ kind: 'note', content: `forgot "${key}".` });
          }
        } else if (sub === 'why') {
          addEntry({ kind: 'note', content: explainPreference(profileRef.current, key) });
        } else if (sub === 'export') {
          const dest = exportProfile(profileRef.current);
          addEntry({
            kind: 'note',
            content: dest ? `profile exported → ${dest}` : 'export failed (could not write file).',
          });
        } else {
          addEntry({
            kind: 'note',
            content:
              'usage: /profile [show · enable · disable · forget <key> · why <key> · export · reset]',
          });
        }
        return true;
      }
      if (cmd === '/model') {
        const [sub, ...subArgs] = arg.split(/\s+/).filter(Boolean);
        // Diagnostic sub-commands.
        if (sub === 'doctor') {
          void runModelDoctor();
          return true;
        }
        if (sub === 'benchmark') {
          const quick = subArgs.includes('--quick');
          const mi = subArgs.indexOf('--model');
          const modelId = mi >= 0 ? subArgs[mi + 1] : undefined;
          void runModelBenchmark({ quick, ...(modelId ? { modelId } : {}) });
          return true;
        }
        // Router tier overrides: /model fast | think — force next turn's model tier.
        if (sub === 'fast' || sub === 'think') {
          if (!config.routerEnabled) {
            addEntry({ kind: 'note', content: 'Model routing is off — enable it in /settings' });
          } else {
            forceTierRef.current = sub as 'fast' | 'think';
            addEntry({ kind: 'note', content: `Next turn: ${sub} model forced` });
          }
          return true;
        }
        // Preset shortcuts: /model cool | fast | balanced | deep | long-context | manual.
        const presetMap: Record<string, InferencePreset> = {
          cool: 'cool',
          fast: 'fast',
          balanced: 'balanced',
          deep: 'deep',
          'long-context': 'long_context',
          long_context: 'long_context',
          manual: 'manual',
        };
        if (sub && presetMap[sub]) {
          applyInferencePreset(presetMap[sub]!);
          return true;
        }
        // Entering the main-model picker: ensure a prior (possibly cancelled)
        // router fast/think pick can't misdirect this selection.
        setModelPickTarget('main');
        setMode('backend_select');
        return true;
      }
      if (cmd === '/settings') {
        setMode('settings');
        return true;
      }
      if (cmd === '/mode') {
        // With an explicit arg, switch directly; otherwise open the picker.
        const direct: Config['mode'] | null =
          arg === 'hands-off' || arg === 'auto'
            ? 'auto'
            : arg === 'hands-on' || arg === 'permissions'
              ? 'permissions'
              : null;
        if (direct) {
          setConfig((c) => ({ ...c, mode: direct }));
          void writeStore({ mode: direct });
          addEntry({ kind: 'note', content: `mode → ${direct}` });
        } else {
          setMode('mode_select');
        }
        return true;
      }
      if (cmd === '/resume') {
        void resumeSession();
        return true;
      }
      return false;
    },
    [
      quit,
      config.systemPrompt,
      config.mode,
      config.bannerAnimation,
      config.routerEnabled,
      resumeSession,
      activeProject,
      focus,
      setFocus,
      recordPersonalizationEvent,
      refreshPersonalizationBlock,
    ],
  );

  // Run one agent turn. `displayText` is shown as the user line; `modelInput`
  // is what the model actually receives (they differ for /research).
  // Holds a turn deferred while we ask for HuggingFace cloud consent.
  const pendingHfRef = useRef<{ display: string; model: string } | null>(null);

  const runTurn = useCallback(
    async (displayText: string, modelInput: string, opts?: { consented?: boolean }) => {
      // Cloud-consent gate: the HuggingFace backend sends prompts and project
      // context off-machine. Never do that until the user has explicitly agreed.
      // Stash the turn and show a consent screen; resume it only on acceptance.
      if (config.backend === 'hf' && !config.hfConsent && !opts?.consented) {
        pendingHfRef.current = { display: displayText, model: modelInput };
        setMode('hf_consent');
        return;
      }
      setIsLoading(true);
      addEntry({ kind: 'user', content: displayText });

      // Overleaf: pull web edits first so the agent never works on a stale paper,
      // and refresh the paper context so it always targets the current main file.
      // Off-work (general) focus skips all project/Overleaf wiring.
      const research = focus === 'research';
      if (research && isOverleafLinked()) {
        const pulled = autoPullOverleaf();
        if (pulled) addEntry({ kind: 'note', content: pulled });
      }
      // Always rebuild the system message from current promptOpts so the live
      // system prompt reflects the project, focus, and personalization block.
      const sysMeta = research ? activeProject : null;
      const turnHistory: Message[] = [
        { role: 'system', content: buildSystem(config.systemPrompt, sysMeta, promptOpts) },
        ...history.slice(1),
      ];

      const controller = new AbortController();
      abortRef.current = controller;
      let acc = '';

      // Per-turn model selection: when routing is on, pick fast or think model.
      let activeModel: ChatModel = model;
      let activeTier: 'fast' | 'think' = 'think';
      let tierForced = false;
      if (config.routerEnabled && fastModel) {
        const forced = forceTierRef.current;
        forceTierRef.current = null; // single-turn override, consumed here
        tierForced = forced !== null;
        const rawTier =
          forced ??
          classifyTurn(modelInput, {
            focus,
            activeTask: activeProject?.paperMode === 'overleaf' ? 'paper' : undefined,
            lastTier: lastTierRef.current,
            hadToolCalls: hadToolCallsRef.current,
            historyLength: turnHistory.length,
          } satisfies RouterContext);
        activeTier = resolveModel(rawTier, lastTierRef.current);
        activeModel = activeTier === 'fast' ? (fastModel ?? model) : (thinkModel ?? model);
      }
      // hadToolCallsRef scope: it reflects whether the PREVIOUS turn ran a tool,
      // so a tool chain keeps its tier for the immediate follow-up. Reset here at
      // the start of every turn so one tool call can't make routing sticky
      // forever; it's set true again below when this turn emits a tool_call.
      hadToolCallsRef.current = false;

      // Laptop context budget + per-turn timing for the slow-turn advisory.
      // Derive the budget fresh from the preset + window each turn so tuning takes
      // effect immediately; only a `manual` preset honors an explicit saved value.
      const budgetTokens =
        config.inferencePreset === 'manual' && config.maxPromptTokens
          ? config.maxPromptTokens
          : promptBudgetFor(config.inferencePreset, config.ollamaNumCtx);
      const compaction = config.contextCompaction !== false;
      const turnStart = Date.now();
      let ttftMs: number | undefined;
      let outChars = 0;
      let hadReasoning = false;
      // Coalesce per-token streaming into ~30fps state updates so a long
      // response doesn't trigger one React render + transcript re-layout per
      // token. The final content is delivered as a chat entry on message_end,
      // so we don't need to flush the tail into `streaming`.
      const streamCoalescer = makeCoalescer<string>(STREAM_FLUSH_MS, setStreaming);

      for await (const event of runAgentLoop(modelInput, turnHistory, activeModel, registry, {
        signal: controller.signal,
        approve,
        askUser,
        preset: config.inferencePreset,
        ...(compaction ? { budget: { maxPromptTokens: budgetTokens } } : {}),
        // Fast tier: no thinking (non-reasoning models error on think:true) and
        // no tools (small models misfire tools on simple greetings/follow-ups).
        ...(config.routerEnabled && activeTier === 'fast' ? { think: false, noTools: true } : {}),
      })) {
        if (event.type === 'message_start') {
          acc = '';
          streamCoalescer.reset();
          setStreaming('');
          setReasoning(false);
          setScrollOffset(0);
        } else if (event.type === 'reasoning') {
          hadReasoning = true;
          setReasoning(true);
        } else if (event.type === 'message_delta') {
          if (ttftMs === undefined) ttftMs = Date.now() - turnStart;
          outChars += event.text.length;
          acc += event.text;
          streamCoalescer.push(acc);
          setReasoning(false); // visible text arrived → past the think block
        } else if (event.type === 'message_end') {
          setStreaming(null);
          setReasoning(false);
          if (event.content.trim()) addEntry({ kind: 'assistant', content: event.content });
        } else if (event.type === 'tool_call') {
          // For a write, snapshot the file's current contents so the result can
          // be shown as a compact diff instead of the model pasting the text.
          if (event.name === 'write_file') {
            try {
              const a = JSON.parse(event.args) as { path?: string; content?: string };
              const resolved = resolveWorkspacePath(String(a.path ?? ''));
              let oldText = '';
              try {
                oldText = readFileSync(resolved, 'utf8');
              } catch {
                /* new file: no prior contents */
              }
              pendingWriteRef.current = {
                path: resolved,
                oldText,
                newText: String(a.content ?? ''),
              };
            } catch {
              pendingWriteRef.current = null;
            }
          } else if (event.name === 'edit_file') {
            // Snapshot the pre-edit contents; the post-edit text is read back from
            // disk when the result lands (edit_file returns only the changed strings).
            try {
              const a = JSON.parse(event.args) as { path?: string };
              const resolved = resolveWorkspacePath(String(a.path ?? ''));
              pendingWriteRef.current = {
                path: resolved,
                oldText: readFileSync(resolved, 'utf8'),
                newText: '',
              };
            } catch {
              pendingWriteRef.current = null;
            }
          }
          hadToolCallsRef.current = true;
          addEntry({ kind: 'tool_call', name: event.name, args: event.args });
        } else if (event.type === 'tool_result') {
          // A fresh project → remember to pop the template chooser after the turn.
          if (event.name === 'create_project' && /^Created and switched/.test(event.result)) {
            createdProjectRef.current = true;
          }
          const w = pendingWriteRef.current;
          pendingWriteRef.current = null;
          if (event.name === 'write_file' && w && /^Written to/.test(event.result)) {
            const { rows, added, removed, truncated } = summarizeDiff(w.oldText, w.newText);
            if (added + removed === 0) {
              addEntry({ kind: 'note', content: `no changes to ${basename(w.path)}` });
            } else {
              addEntry({ kind: 'diff', path: w.path, rows, added, removed, truncated });
            }
          } else if (event.name === 'edit_file' && w && /^Edited /.test(event.result)) {
            // Read the post-edit file to render the change as a diff.
            let newText = '';
            try {
              newText = readFileSync(w.path, 'utf8');
            } catch {
              /* gone */
            }
            const { rows, added, removed, truncated } = summarizeDiff(w.oldText, newText);
            if (added + removed === 0) {
              addEntry({ kind: 'note', content: `no changes to ${basename(w.path)}` });
            } else {
              addEntry({ kind: 'diff', path: w.path, rows, added, removed, truncated });
            }
          } else {
            addEntry({ kind: 'tool_result', name: event.name, result: event.result });
          }
        } else if (event.type === 'error') {
          setStreaming(null);
          setReasoning(false);
          addEntry({ kind: 'error', message: event.message });
        } else if (event.type === 'cancelled') {
          setStreaming(null);
          setReasoning(false);
          addEntry({ kind: 'note', content: 'interrupted' });
        } else if (event.type === 'done') {
          setHistory(event.messages);
          setEntries((prev) => {
            void saveSession(event.messages, prev);
            return prev;
          });
          // Honest, quiet per-turn perf feedback. Only probe `ollama ps` for CPU
          // spill on turns already slow enough to be worth the shell call.
          const totalMs = Date.now() - turnStart;
          let cpuSpill = false;
          if (config.backend === 'ollama' && totalMs >= 8000) {
            const row = psRowFor(ollamaPs(), config.modelId);
            cpuSpill = row ? !row.fullGpu : false;
          }
          const a = assessTurn({
            promptTokens: estimateMessagesTokens(turnHistory) + Math.ceil(modelInput.length / 4),
            totalMs,
            ...(ttftMs !== undefined ? { ttftMs } : {}),
            outputTokens: Math.ceil(outChars / 4),
            budget: budgetTokens,
            cpuSpill,
            hadReasoning,
          });
          if (a.slow && a.message && a.message !== lastPerfNoteRef.current) {
            lastPerfNoteRef.current = a.message;
            addEntry({ kind: 'note', content: a.message });
          } else if (!a.slow) {
            lastPerfNoteRef.current = '';
          }
          lastTierRef.current = activeTier;
          if (config.routerEnabled) {
            const mode = config.routerNotes ?? 'changes';
            if (shouldShowTierNote(mode, lastShownTierRef.current, activeTier, tierForced)) {
              addEntry({ kind: 'note', content: formatTierNote(activeTier, activeModel.modelId) });
            }
            lastShownTierRef.current = activeTier;
          }

          // Personalization: capture an explicitly stated preference from this
          // turn's user message (privacy-gated). Only explicit captures get a
          // quiet confirmation; inferred learning stays silent.
          if (config.personalizationEnabled) {
            const detected = detectExplicitPreference(modelInput);
            if (detected) {
              const clean = sanitizePreference(detected.phrase);
              if (clean.ok) {
                profileRef.current = applyExplicit(
                  profileRef.current,
                  detected,
                  clean.value,
                  new Date().toISOString(),
                );
                void saveProfile(profileRef.current);
                refreshPersonalizationBlock();
                addEntry({
                  kind: 'note',
                  content: `noted — ${clean.value}  ·  /profile to view or undo`,
                });
              }
            }
          }
        }
      }

      abortRef.current = null;
      setIsLoading(false);

      // Auto-sync paper edits to Overleaf when working on a linked project.
      if (research) {
        const sync = autoSyncOverleaf();
        if (sync) addEntry({ kind: 'note', content: sync });
      }

      // A project was just created this turn: sync app state to it and, if it has
      // no paper yet, pop the template chooser. This makes the template picker
      // reliable regardless of whether the model thought to offer it.
      if (createdProjectRef.current) {
        createdProjectRef.current = false;
        const meta = getActiveProject();
        if (meta) {
          setActiveProjectState(meta);
          setFocusState('research');
          setHistory((h) => [
            { role: 'system', content: buildSystem(config.systemPrompt, meta, promptOpts) },
            ...h.slice(1),
          ]);
          if (!existsSync(join(projectPaths(meta.slug).paper, 'main.tex'))) {
            setTemplateTarget(meta);
            setMode('template_select');
          }
        }
      }
    },
    [
      history,
      model,
      registry,
      approve,
      askUser,
      config.systemPrompt,
      config.backend,
      config.hfConsent,
      config.personalizationEnabled,
      activeProject,
      focus,
      promptOpts,
      refreshPersonalizationBlock,
    ],
  );

  // Resolve the HuggingFace consent screen: on acceptance persist the flag and
  // resume the stashed turn; on cancel, nothing was sent.
  const onHfConsent = useCallback(
    (accepted: boolean) => {
      setMode('chat');
      const pending = pendingHfRef.current;
      pendingHfRef.current = null;
      if (accepted) {
        setConfig((c) => ({ ...c, hfConsent: true }));
        void writeStore({ hfConsent: true });
        addEntry({
          kind: 'note',
          content:
            'HuggingFace cloud enabled — prompts, project context, and tool output will be sent to HuggingFace.',
        });
        if (pending) void runTurn(pending.display, pending.model, { consented: true });
      } else {
        addEntry({
          kind: 'note',
          content: 'Cancelled — nothing left your machine. Switch to a local backend with /model.',
        });
      }
    },
    [runTurn],
  );

  const researchSubmit = useCallback(
    (claim: string) => {
      addEntry({ kind: 'note', content: `researching the literature on: ${claim}` });
      void runTurn(claim, correctionsDirective(claim));
    },
    [runTurn],
  );

  // Open the user's editor on a skill template; save and register on close.
  const composeSkill = useCallback(() => {
    if (!isRawModeSupported) {
      addEntry({ kind: 'error', message: 'editor not available in this terminal' });
      return;
    }
    const tmp = join(tmpdir(), `handoff-skill-${Date.now()}.md`);
    try {
      writeFileSync(tmp, SKILL_TEMPLATE, 'utf-8');
    } catch (e) {
      addEntry({ kind: 'error', message: `could not create template: ${String(e)}` });
      return;
    }

    const editor = process.env['VISUAL'] || process.env['EDITOR'] || 'nano';
    let failed = false;
    try {
      setRawMode(false);
      stdout.write('\x1b[2J\x1b[3J\x1b[H'); // hand a clean screen to the editor
      const r = spawnSync(editor, [tmp], { stdio: 'inherit' });
      if (r.error) failed = true;
    } catch {
      failed = true;
    } finally {
      setRawMode(true);
      inkControl.clear(); // reset Ink's render state, then repaint fresh
      stdout.write('\x1b[2J\x1b[3J\x1b[H');
    }

    if (failed) {
      addEntry({
        kind: 'error',
        message: `couldn't open editor "${editor}". Set $EDITOR (e.g. export EDITOR=nano) and retry.`,
      });
      return;
    }

    let content = '';
    try {
      content = readFileSync(tmp, 'utf-8');
      unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    if (!content.trim() || content.trim() === SKILL_TEMPLATE.trim()) {
      addEntry({ kind: 'note', content: 'skill composer cancelled (no changes)' });
      return;
    }
    const res = saveUserSkill(content);
    if ('error' in res) {
      addEntry({ kind: 'error', message: `skill not saved — ${res.error}` });
    } else {
      addEntry({
        kind: 'note',
        content: `skill "${res.name}" created — run it with /skill ${res.name}`,
      });
    }
  }, [stdout, setRawMode, isRawModeSupported]);

  const runSkill = useCallback(
    (name: string) => {
      const skill = findSkill(name);
      if (!skill) {
        addEntry({ kind: 'error', message: `no skill "${name}" — type /skills to list yours` });
        return;
      }
      void runTurn(`/skill ${skill.name}`, `Follow this skill's instructions:\n\n${skill.body}`);
    },
    [runTurn],
  );

  const handleSubmit = useCallback(
    async (userInput: string) => {
      const trimmed = userInput.trim();
      // /research keeps the original-case claim (runCommand lowercases args).
      if (/^\/research\b/i.test(trimmed)) {
        const claim = trimmed.replace(/^\/research\s*/i, '');
        if (claim) researchSubmit(claim);
        else addEntry({ kind: 'note', content: 'usage: /research <claim or topic>' });
        return;
      }
      // /project keeps original-case names (runCommand lowercases args).
      if (/^\/projects?\b/i.test(trimmed)) {
        handleProject(trimmed.replace(/^\/projects?\s*/i, ''));
        return;
      }
      const lower = trimmed.toLowerCase();
      if (lower === '/compose-skill' || lower === '/compose') {
        composeSkill();
        return;
      }
      if (lower === '/overleaf') {
        handleOverleaf();
        return;
      }
      if (lower === '/skills') {
        const skills = loadSkills();
        addEntry({
          kind: 'note',
          content: skills.length
            ? 'skills: ' + skills.map((s) => s.name).join(', ')
            : 'no skills yet — type /compose-skill to create one',
        });
        return;
      }
      if (lower === '/skill' || lower.startsWith('/skill ')) {
        const name = trimmed.replace(/^\/skill\s*/i, '');
        if (name) runSkill(name);
        else addEntry({ kind: 'note', content: 'usage: /skill <name>  ·  /skills to list' });
        return;
      }
      if (/^\/handoff\b/i.test(trimmed)) {
        handleHandoff(trimmed.replace(/^\/handoff\s*/i, ''));
        return;
      }
      if (
        /^\/(audit-paper|provenance|claims|unsupported|claim-add|claim-status|claim-link-run|claim-link-paper)\b/i.test(
          trimmed,
        )
      ) {
        const spaceIdx = trimmed.indexOf(' ');
        const cmd = (spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx)).toLowerCase();
        const args = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx + 1);
        handleClaims(cmd, args);
        return;
      }
      if (/^\/(reproduce|rerun|compare-runs|promote-run)\b/i.test(trimmed)) {
        const spaceIdx = trimmed.indexOf(' ');
        const cmd = (spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx)).toLowerCase();
        const args = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx + 1);
        handleCapsules(cmd, args);
        return;
      }
      if (userInput.startsWith('/')) {
        if (runCommand(userInput)) return;
        addEntry({ kind: 'error', message: `unknown command: ${userInput}` });
        return;
      }
      await runTurn(userInput, userInput);
    },
    [
      runCommand,
      runTurn,
      researchSubmit,
      composeSkill,
      runSkill,
      handleProject,
      handleOverleaf,
      handleHandoff,
      handleClaims,
      handleCapsules,
    ],
  );

  const onBackendPicked = useCallback((backend: Backend) => {
    // Local OpenAI-compat backends (vLLM/llama.cpp/MLX) use their default port and
    // go straight to model selection; the URL can be overridden via env vars.
    setConfig((c) => ({ ...c, backend }));
    void writeStore({ backend });
    setMode('model_select');
  }, []);

  const onToggleFavourite = useCallback((modelId: string) => {
    // Functional updater: read the freshest favourites from state (never a
    // stale closure), compute the next set, and persist. Stable identity.
    setConfig((c) => {
      const backend = c.backend as Backend;
      const existing = (c.favourites ?? []) as FavouriteEntry[];
      const idx = existing.findIndex((f) => f.backend === backend && f.modelId === modelId);
      const next =
        idx === -1 ? [...existing, { backend, modelId }] : existing.filter((_, i) => i !== idx);
      void writeStore({ favourites: next });
      return { ...c, favourites: next };
    });
  }, []);

  const onModelPicked = useCallback(
    (modelId: string, hasQuant: boolean) => {
      // Router sub-targets: update the fast/think slot instead of the main model.
      if (modelPickTarget === 'router_fast') {
        setConfig((c) => ({ ...c, routerFastModelId: modelId }));
        void writeStore({ routerFastModelId: modelId });
        setModelPickTarget('main');
        if (config.backend === 'ollama') {
          setPullModelId(modelId);
          setMode('model_prepare');
        } else {
          setMode('chat');
          addEntry({ kind: 'note', content: `routing fast model → ${modelId}` });
        }
        return;
      }
      if (modelPickTarget === 'router_think') {
        setConfig((c) => ({ ...c, routerThinkModelId: modelId }));
        void writeStore({ routerThinkModelId: modelId });
        setModelPickTarget('main');
        if (config.backend === 'ollama') {
          setPullModelId(modelId);
          setMode('model_prepare');
        } else {
          setMode('chat');
          addEntry({ kind: 'note', content: `routing think model → ${modelId}` });
        }
        return;
      }
      setConfig((c) => ({ ...c, modelId }));
      recordPersonalizationEvent({
        type: 'model_selected',
        timestamp: new Date().toISOString(),
        summary: modelId,
        metadata: { modelId, backend: config.backend },
      });
      if (hasQuant) {
        setMode('quant_select');
        return;
      }
      void writeStore({ modelId });
      // Ollama: pull the model now (with progress) before returning to chat.
      if (config.backend === 'ollama') {
        setPullModelId(modelId);
        setMode('model_prepare');
      } else {
        setMode('chat');
        addEntry({ kind: 'note', content: `switched model → ${modelId}` });
      }
    },
    [config.backend, modelPickTarget, recordPersonalizationEvent],
  );

  const onQuantPicked = useCallback(
    (quant: string) => {
      const modelId = withQuant(config.modelId, quant);
      setConfig((c) => ({ ...c, modelId }));
      void writeStore({ modelId });
      // Quant only applies to Ollama models — pull the resolved tag now.
      setPullModelId(modelId);
      setMode('model_prepare');
    },
    [config.modelId],
  );

  // 'model_prepare' finished: the model is pulled and Ollama is serving.
  const onModelPrepared = useCallback(() => {
    setMode('chat');
    addEntry({ kind: 'note', content: `model ready → ${pullModelId}` });
  }, [pullModelId]);

  // User backed out of the pull — return to the model list.
  const onModelPrepareCancel = useCallback(() => {
    setMode('model_select');
  }, []);

  const onThemePicked = useCallback((name: string) => {
    setConfig((c) => ({ ...c, theme: name }));
    void writeStore({ theme: name });
    setMode('chat');
    addEntry({ kind: 'note', content: `theme → ${name}` });
  }, []);

  // Apply a laptop inference preset: bundle context + max output + keep-alive +
  // prompt budget for the current hardware, persist, and report what changed.
  // Shared by the /settings picker and the `/model cool|fast|…` shortcuts.
  const applyInferencePreset = useCallback(
    (preset: InferencePreset) => {
      if (preset === 'manual') {
        setConfig((c) => ({ ...c, inferencePreset: 'manual' }));
        void writeStore({ inferencePreset: 'manual' });
        addEntry({
          kind: 'note',
          content: 'inference preset → manual  ·  context/output/keep-alive left as set',
        });
        return;
      }
      const r = applyPreset(preset, detectHardware());
      if (!r) return;
      setConfig((c) => ({
        ...c,
        inferencePreset: preset,
        modelPerformanceMode: r.modelPerformanceMode,
        ollamaNumCtx: r.ollamaNumCtx,
        maxNewTokens: r.maxNewTokens,
        ollamaKeepAlive: r.ollamaKeepAlive,
      }));
      void writeStore({
        inferencePreset: preset,
        modelPerformanceMode: r.modelPerformanceMode,
        ollamaNumCtx: r.ollamaNumCtx,
        maxNewTokens: r.maxNewTokens,
        ollamaKeepAlive: r.ollamaKeepAlive,
        contextMigrated: true,
      });
      addEntry({
        kind: 'note',
        content:
          `inference preset → ${PRESET_LABELS[preset].label.toLowerCase()}  ·  context ${r.ollamaNumCtx}  ·  ` +
          `output ${r.maxNewTokens}  ·  keep-alive ${r.ollamaKeepAlive}  ·  prompt budget ~${Math.round(r.maxPromptTokens / 1000)}K` +
          (r.warning ? `\n${r.warning}` : ''),
      });
      recordPersonalizationEvent({
        type: 'settings_changed',
        timestamp: new Date().toISOString(),
        summary: `performanceMode=${r.modelPerformanceMode}`,
        metadata: { key: 'performanceMode', value: r.modelPerformanceMode },
      });
    },
    [recordPersonalizationEvent],
  );

  const onPresetPicked = useCallback(
    (preset: InferencePreset) => {
      applyInferencePreset(preset);
      setMode('chat');
    },
    [applyInferencePreset],
  );

  // Personalization sub-menu picks: toggle a flag, reset, or view the profile.
  const onPersonalizationPicked = useCallback(
    (key: string) => {
      const toggle = (
        field:
          | 'personalizationEnabled'
          | 'personalizationIncludeInPrompt'
          | 'personalizationAllowCloudPrompt'
          | 'personalizationLearnFromProjects'
          | 'personalizationLearnFromPerformance',
        label: string,
      ) => {
        const on = !config[field];
        setConfig((c) => ({ ...c, [field]: on }));
        void writeStore({ [field]: on });
        addEntry({ kind: 'note', content: `${label} → ${on ? 'on' : 'off'}` });
      };
      switch (key) {
        case 'enabled':
          toggle('personalizationEnabled', 'personalization');
          break;
        case 'include_prompt':
          toggle('personalizationIncludeInPrompt', 'personalization in prompt');
          break;
        case 'allow_cloud':
          toggle('personalizationAllowCloudPrompt', 'personalization in cloud prompts');
          break;
        case 'learn_projects':
          toggle('personalizationLearnFromProjects', 'learn from projects');
          break;
        case 'learn_performance':
          toggle('personalizationLearnFromPerformance', 'learn from performance');
          break;
        case 'reset':
          profileRef.current = resetProfile();
          refreshPersonalizationBlock();
          addEntry({
            kind: 'note',
            content: 'personalization profile cleared (previous version backed up).',
          });
          break;
        case 'show':
          addEntry({ kind: 'note', content: formatProfileSummary(profileRef.current) });
          break;
      }
      setMode('chat');
    },
    [config, refreshPersonalizationBlock],
  );

  const onSettingsPicked = useCallback(
    (
      v:
        | 'preset'
        | 'personalization'
        | 'theme'
        | 'mascot'
        | 'performance_mode'
        | 'context'
        | 'flash_attention'
        | 'kv_cache'
        | 'router_toggle'
        | 'router_fast_model'
        | 'router_think_model'
        | 'router_notes',
    ) => {
      if (v === 'preset') {
        setMode('preset_select');
        return;
      }
      if (v === 'personalization') {
        setMode('personalization_select');
        return;
      }
      if (v === 'theme') {
        setMode('theme_select');
        return;
      }
      if (v === 'performance_mode') {
        // Cycle cool → balanced → max and re-derive a safe context default for
        // the new mode (only when the user hasn't hand-set an unusual value).
        const order: PerformanceMode[] = ['cool', 'balanced', 'max'];
        const cur = (config.modelPerformanceMode as PerformanceMode) ?? 'cool';
        const next = order[(order.indexOf(cur) + 1) % order.length]!;
        const ctx = defaultContextForHardware(detectHardware(), next);
        setConfig((c) => ({ ...c, modelPerformanceMode: next, ollamaNumCtx: ctx }));
        void writeStore({ modelPerformanceMode: next, ollamaNumCtx: ctx, contextMigrated: true });
        setMode('chat');
        addEntry({
          kind: 'note',
          content:
            `performance mode → ${next}  ·  context → ${ctx}` +
            (next === 'max' ? '  ·  larger/hotter models now allowed — watch heat' : ''),
        });
        return;
      }
      if (v === 'context') {
        setMode('context_input');
        return;
      }
      if (v === 'kv_cache') {
        setMode('kv_cache_select');
        return;
      }
      if (v === 'flash_attention') {
        const on = !config.ollamaFlashAttention;
        setConfig((c) => ({ ...c, ollamaFlashAttention: on }));
        void writeStore({ ollamaFlashAttention: on });
        setMode('chat');
        addEntry({
          kind: 'note',
          content: `flash attention → ${on ? 'on' : 'off'}  ·  applies next time handoff starts Ollama (stop any running server first)`,
        });
        return;
      }
      if (v === 'router_toggle') {
        const on = !config.routerEnabled;
        setConfig((c) => ({ ...c, routerEnabled: on }));
        void writeStore({ routerEnabled: on });
        setMode('chat');
        addEntry({ kind: 'note', content: `model routing → ${on ? 'on' : 'off'}` });
        return;
      }
      if (v === 'router_fast_model') {
        setModelPickTarget('router_fast');
        setMode('model_select');
        return;
      }
      if (v === 'router_think_model') {
        setModelPickTarget('router_think');
        setMode('model_select');
        return;
      }
      if (v === 'router_notes') {
        // Cycle changes → always → off.
        const order = ['changes', 'always', 'off'] as const;
        const cur = config.routerNotes ?? 'changes';
        const next = order[(order.indexOf(cur) + 1) % order.length]!;
        setConfig((c) => ({ ...c, routerNotes: next }));
        void writeStore({ routerNotes: next });
        setMode('chat');
        addEntry({ kind: 'note', content: `routing notes → ${next}` });
        return;
      }
      const on = config.bannerAnimation === false;
      setConfig((c) => ({ ...c, bannerAnimation: on }));
      void writeStore({ bannerAnimation: on });
      setMode('chat');
      addEntry({ kind: 'note', content: `banner mascot → ${on ? 'on' : 'off'}` });
    },
    [
      config.bannerAnimation,
      config.ollamaFlashAttention,
      config.modelPerformanceMode,
      config.routerEnabled,
      config.routerNotes,
    ],
  );

  const onContextPicked = useCallback((numCtx: number) => {
    setConfig((c) => ({ ...c, ollamaNumCtx: numCtx }));
    void writeStore({ ollamaNumCtx: numCtx });
    setMode('chat');
    addEntry({ kind: 'note', content: `context window → ${numCtx}` });
  }, []);

  const onKvCachePicked = useCallback((kvType: 'f16' | 'q8_0' | 'q4_0') => {
    setConfig((c) => ({ ...c, ollamaKvCacheType: kvType }));
    void writeStore({ ollamaKvCacheType: kvType });
    setMode('chat');
    addEntry({
      kind: 'note',
      content: `KV cache → ${kvType}  ·  applies next time handoff starts Ollama (stop any running server first)`,
    });
  }, []);

  const onModePicked = useCallback(
    (m: Config['mode']) => {
      setConfig((c) => ({ ...c, mode: m }));
      void writeStore({ mode: m });
      recordPersonalizationEvent({
        type: 'settings_changed',
        timestamp: new Date().toISOString(),
        summary: `mode=${m}`,
        metadata: { key: 'mode', value: m },
      });
      setMode('chat');
      addEntry({
        kind: 'note',
        content: `mode → ${m === 'auto' ? 'hands-off (auto)' : 'hands-on (permissions)'}`,
      });
    },
    [recordPersonalizationEvent],
  );

  // --- Build the exact line list for the scrollable transcript ----------
  // The banner is the first lines, so it scrolls away with the conversation.
  const width = Math.max(20, columns - 1);
  const toolCount = registry.list().length;
  const spinner = SPINNER_FRAMES[tick % SPINNER_FRAMES.length];

  // Animated banner logo. It only ticks while the banner is on-screen (the ref
  // below), and degrades to the static logo when it can't or shouldn't animate:
  // no tty, reduced-motion env, disabled in config, or a one-column narrow banner.
  const logoColors = useMemo(() => themePalette(theme), [theme]);
  const twoCol = Math.max(24, width) - 7 - LEFT_INNER >= 32;
  const animateMascot =
    (process.stdout.isTTY ?? false) &&
    twoCol &&
    config.bannerAnimation !== false &&
    process.env['HANDOFF_REDUCED_MOTION'] == null;
  const bannerVisibleRef = useRef(true);
  const mascotRows = useLogoAnimation({
    width: LEFT_INNER,
    height: CANVAS_H,
    colors: logoColors,
    // 12fps (not 20): the gradient sweeps ~26 near-full-width rows, and Ink
    // repaints the whole changed block each frame, so a lower rate cuts repaint
    // + GC pressure ~40% and reduces flicker on SSH/tmux, while the sweep stays
    // smooth (see ERRORS.md #1). The transcript is already decoupled from this
    // (entryNodes is memoized on [entries, theme, width]).
    fps: 12,
    color: process.env['NO_COLOR'] == null,
    enabled: animateMascot,
    reducedMotion: process.env['HANDOFF_REDUCED_MOTION'] != null,
    visible: bannerVisibleRef,
  });

  // The banner header. Rebuilt each animation frame (cheap — a single card),
  // kept separate from the transcript body so a frame tick doesn't re-lay entries.
  const bannerNodes = useMemo(
    () =>
      bannerLines({
        backend: config.backend,
        modelId: config.modelId,
        theme,
        width,
        mode: config.mode,
        toolCount,
        focus,
        ...(mascotRows ? { mascotRows } : {}),
        ...(activeProject ? { project: activeProject.title } : {}),
      }),
    [
      config.backend,
      config.modelId,
      config.mode,
      theme,
      width,
      toolCount,
      focus,
      activeProject,
      mascotRows,
    ],
  );

  // The transcript body — stable across animation frames, so it isn't rebuilt
  // on every mascot tick (only when the conversation itself changes).
  const entryNodes = useMemo(() => {
    const out: React.ReactNode[] = [];
    entries.forEach((e, i) => out.push(...entryLines(e, theme, width, `e${i}`)));
    return out;
  }, [entries, theme, width]);

  // The live "working…" indicator, appended after the transcript.
  const loadingNodes: React.ReactNode[] = [];
  {
    // A live elapsed read-out (after the first second) so long turns feel alive.
    const secs = Math.floor((tick * 90) / 1000);
    const elapsed = secs >= 1 ? `  ${secs}s` : '';
    if (streaming !== null) {
      loadingNodes.push(<Text key="s-lead"> </Text>);
      // If the model is mid-emitting an inline tool call, don't show the raw JSON.
      const t = streaming.trimStart();
      if (reasoning && t === '') {
        // Inside a <think> block — show a status, never the raw reasoning.
        loadingNodes.push(
          <Text key="reasoning" color={theme.tool}>
            {'  '}
            {spinner} thinking…{elapsed}
          </Text>,
        );
      } else if (t.startsWith('{') || t.startsWith('<tool_call')) {
        loadingNodes.push(
          <Text key="deciding" color={theme.tool}>
            {'  '}
            {spinner} preparing an action…{elapsed}
          </Text>,
        );
      } else if (t === '') {
        loadingNodes.push(
          <Text key="responding" color={theme.tool}>
            {'  '}
            {spinner} responding…{elapsed}
          </Text>,
        );
      } else {
        loadingNodes.push(...assistantLines(streaming, theme, width, 'stream'));
      }
    } else if (isLoading) {
      loadingNodes.push(<Text key="s-lead"> </Text>);
      loadingNodes.push(
        <Text key="thinking" color={theme.tool}>
          {'  '}
          {spinner} thinking…{elapsed}
        </Text>,
      );
    }
  }

  const allLines = [...bannerNodes, ...entryNodes, ...loadingNodes];

  // Footer chrome: gap + status(1) + input box + optional approval/hint.
  // The slash menu is open while typing a command word (no args yet).
  const menuMatches = matchCommands(input);
  const menuActive = menuMatches.length > 0;
  // Show up to MAX_MENU_VISIBLE rows at a time; scroll the window to keep the
  // cursor visible. No "X more" line — arrows scroll the list.
  const MAX_MENU_VISIBLE = 8;
  const menuSel = menuActive ? Math.min(menuIndex, menuMatches.length - 1) : 0;
  const menuWindowStart = Math.max(
    0,
    Math.min(menuSel - Math.floor(MAX_MENU_VISIBLE / 2), menuMatches.length - MAX_MENU_VISIBLE),
  );
  const visibleMenuMatches = menuMatches.slice(menuWindowStart, menuWindowStart + MAX_MENU_VISIBLE);
  // Name column width: based on ALL matches (not just the visible window) so the
  // description column stays at the same position as you scroll. Cursor '❯ ' = 2, gap = 2.
  const maxMenuNameLen = menuMatches.reduce((m, c) => Math.max(m, c.name.length), 0);
  // Width available for description text. The paddingX={1} on the menu Box adds 2.
  const menuDescWidth = Math.max(20, width - maxMenuNameLen - 6);
  // Input box height grows with line count (border top + border bottom = +2).
  const inputLineCount = Math.max(1, input.split('\n').length);
  // Estimate wrapped line count per item for footer height (word-wrap approximation).
  const menuItemLines = visibleMenuMatches.reduce(
    (n, c) => n + Math.max(1, Math.ceil(c.desc.length / menuDescWidth)),
    0,
  );
  const footerHeight = INPUT_GAP + 1 + (inputLineCount + 2) + (pending ? 5 : 0) + menuItemLines;
  const viewportHeight = Math.max(3, rows - 1 - footerHeight);

  const maxOffset = Math.max(0, allLines.length - viewportHeight);
  const clampedOffset = Math.min(scrollOffset, maxOffset);
  const windowEnd = allLines.length - clampedOffset;
  const windowStart = Math.max(0, windowEnd - viewportHeight);
  // The mascot animates only while the top of the banner is in view; once the
  // conversation scrolls it away, the animation loop goes idle.
  bannerVisibleRef.current = windowStart === 0;
  const windowLines = allLines.slice(windowStart, windowEnd);
  // Bottom-pad so content is top-aligned; the footer stays pinned at the bottom.
  const pad = Math.max(0, viewportHeight - windowLines.length);
  const padLines = Array.from({ length: pad }, (_, i) => <Text key={`pad${i}`}> </Text>);

  const maxOffsetRef = useRef(0);
  maxOffsetRef.current = maxOffset;
  const pageRef = useRef(1);
  pageRef.current = Math.max(1, viewportHeight - 1);
  const scrollUp = useCallback(
    (n: number) => setScrollOffset((s) => Math.min(maxOffsetRef.current, s + n)),
    [],
  );
  const scrollDown = useCallback((n: number) => setScrollOffset((s) => Math.max(0, s - n)), []);

  useInput((char, key) => {
    if (key.ctrl && char === 'c') {
      quit();
      return;
    }

    // While a question is on screen the Question component owns all input.
    if (question) return;

    if (pending) {
      if (char === 'y') {
        pending.resolve(true);
        setPending(null);
      } else if (char === 'a') {
        setConfig((c) => ({ ...c, mode: 'auto' }));
        void writeStore({ mode: 'auto' });
        pending.resolve(true);
        setPending(null);
      } else if (char === 'n' || key.escape) {
        pending.resolve(false);
        setPending(null);
      }
      return;
    }

    if (mode !== 'chat') return;

    // ── Global shortcuts (work any time in chat mode) ─────────────────────
    // Shift+Tab: toggle hands-on ↔ hands-off without opening the menu.
    if (key.tab && key.shift) {
      const next = config.mode === 'auto' ? 'permissions' : 'auto';
      setConfig((c) => ({ ...c, mode: next }));
      void writeStore({ mode: next });
      return;
    }

    // ── Slash-command menu: arrows highlight, Tab completes, Enter runs. ──
    if (menuActive && !isLoading) {
      if (key.upArrow) {
        setMenuIndex((i) => (i - 1 + menuMatches.length) % menuMatches.length);
        return;
      }
      if (key.downArrow) {
        setMenuIndex((i) => (i + 1) % menuMatches.length);
        return;
      }
      if (key.tab) {
        const completed = menuMatches[menuSel]!.name + ' ';
        setInput(completed);
        setCursor(completed.length);
        setMenuIndex(0);
        return;
      }
      if (key.return) {
        const name = menuMatches[menuSel]!.name;
        setInput('');
        setCursor(0);
        setMenuIndex(0);
        void handleSubmit(name);
        return;
      }
      // Backspace/Delete: remove the last char and reset selection.
      if (key.backspace || key.delete || char === '\x7f') {
        setMenuIndex(0);
        setInput((v) => v.slice(0, -1));
        setCursor((c) => Math.max(0, c - 1));
        return;
      }
      // Escape: dismiss the menu by clearing the input.
      if (key.escape) {
        setMenuIndex(0);
        setInput('');
        setCursor(0);
        return;
      }
    }

    // PageUp/PageDown always page the transcript — a mouse-independent way to
    // read back through a long conversation.
    if (key.pageUp) return scrollUp(pageRef.current);
    if (key.pageDown) return scrollDown(pageRef.current);

    if (key.upArrow) return scrollUp(SCROLL_STEP);
    if (key.downArrow) return scrollDown(SCROLL_STEP);

    // Esc interrupts the model mid-generation; while thinking, swallow all
    // other keys so a stray press can't leak into the next prompt.
    if (key.escape && isLoading) {
      abortRef.current?.abort();
      return;
    }
    if (isLoading) return;

    // Enter: a plain Return submits; Shift+Enter (or any modified Enter) inserts a
    // newline. Terminals send Shift+Enter as an escape sequence Ink can't parse
    // (e.g. CSI 27;2;13~ under modifyOtherKeys), so classifyEnter reads it — this
    // is what used to leak "[27;2;13~" into the box.
    const enter = classifyEnter(char);
    const clampC = (n: number) => Math.max(0, Math.min(input.length, n));
    const at = clampC(cursor);

    if (enter === 'newline' || (key.return && key.shift)) {
      setInput(input.slice(0, at) + '\n' + input.slice(at));
      setCursor(at + 1);
      return;
    }
    if (key.return || enter === 'submit') {
      const val = input.trim();
      if (val) {
        historyRef.current = pushHistory(historyRef.current, val);
        historyCursorRef.current = null; // exit history browsing on submit
        setInput('');
        setCursor(0);
        void handleSubmit(val);
      }
      return;
    }

    // Move the caret within the prompt (this is what "arrows won't move back" was).
    if (key.leftArrow) {
      setCursor(clampC(cursor - 1));
      return;
    }
    if (key.rightArrow) {
      setCursor(clampC(cursor + 1));
      return;
    }
    if (key.ctrl && char === 'a') {
      setCursor(0);
      return;
    } // line start
    if (key.ctrl && char === 'e') {
      setCursor(input.length);
      return;
    } // line end
    // Readline kill keys. Editing exits history browsing.
    if (key.ctrl && char === 'u') {
      const r = killToStart(input, at);
      historyCursorRef.current = null;
      setInput(r.text);
      setCursor(r.cursor);
      return;
    }
    if (key.ctrl && char === 'k') {
      const r = killToEnd(input, at);
      historyCursorRef.current = null;
      setInput(r.text);
      setCursor(r.cursor);
      return;
    }
    if (key.ctrl && char === 'w') {
      const r = deleteWordBack(input, at);
      historyCursorRef.current = null;
      setInput(r.text);
      setCursor(r.cursor);
      return;
    }
    // Ctrl-P / Ctrl-N: browse submitted-input history (readline-style). Kept off
    // the arrow keys so it never fights transcript scroll or the slash-menu.
    if (key.ctrl && char === 'p') {
      if (!historyCursorRef.current) {
        historyCursorRef.current = new HistoryCursor(historyRef.current, input);
      }
      const prev = historyCursorRef.current.prev();
      if (prev !== null) {
        setInput(prev);
        setCursor(prev.length);
      }
      return;
    }
    if (key.ctrl && char === 'n') {
      if (historyCursorRef.current) {
        const nextVal = historyCursorRef.current.next();
        if (nextVal !== null) {
          setInput(nextVal);
          setCursor(nextVal.length);
        }
        if (historyCursorRef.current.atDraft()) historyCursorRef.current = null;
      }
      return;
    }

    // Backspace/Delete removes the character before the caret.
    if (key.backspace || key.delete || char === '\x7f') {
      if (at > 0) {
        historyCursorRef.current = null; // editing exits history browsing
        setInput(input.slice(0, at - 1) + input.slice(at));
        setCursor(at - 1);
      }
      return;
    }

    // Swallow any other complete escape sequence (modified arrows, function keys,
    // delivered with the ESC byte stripped) so it can't leak into the box as text.
    if (isCompleteEscapeSeq(char)) return;

    if (char && !key.ctrl && !key.meta && !key.escape) {
      // ~ (Shift+`) with an empty box: silently toggle research ↔ off-work focus.
      if (char === '~' && !input) {
        const f: Focus = focus === 'general' ? 'research' : 'general';
        setFocusState(f);
        void writeStore({ focus: f });
        const meta = f === 'general' ? null : getActiveProject();
        setHistory((h) => [
          { role: 'system', content: buildSystem(config.systemPrompt, meta, promptOpts) },
          ...h.slice(1),
        ]);
        return;
      }
      const clean = sanitizeTyped(char);
      if (clean) {
        historyCursorRef.current = null; // typing exits history browsing
        setInput(input.slice(0, at) + clean + input.slice(at));
        setCursor(at + clean.length);
      }
    }
  });

  const overlay = (
    <Overlays
      mode={mode}
      config={config}
      theme={theme}
      activeProject={activeProject}
      question={question}
      vllmModels={vllmModels}
      llamaCppModels={llamaCppModels}
      mlxModels={mlxModels}
      ollamaModels={ollamaModels}
      pullModelId={pullModelId}
      bannerAnimation={config.bannerAnimation !== false}
      onSettingsPicked={onSettingsPicked}
      onContextPicked={onContextPicked}
      onKvCachePicked={onKvCachePicked}
      onPresetPicked={onPresetPicked}
      onPersonalizationPicked={onPersonalizationPicked}
      modelPersonalization={{
        ...(profileRef.current.modelAndPerformance.preferredModels?.value
          ? { preferredModels: profileRef.current.modelAndPerformance.preferredModels.value }
          : {}),
        ...(profileRef.current.modelAndPerformance.rejectedModels?.value
          ? { rejectedModels: profileRef.current.modelAndPerformance.rejectedModels.value }
          : {}),
        slowModels: profileRef.current.modelAndPerformance.laptopPerformanceNotes
          .map((n) => n.text.split(/\s+/)[0] ?? '')
          .filter(Boolean),
        ...(profileRef.current.modelAndPerformance.prefersFastSmallModels?.value
          ? { prefersFastSmallModels: true }
          : {}),
      }}
      onHfConsent={onHfConsent}
      onCancel={() => {
        // Backing out of any overlay clears a pending router fast/think pick so
        // a later main-model selection can't be written into a router slot.
        setModelPickTarget('main');
        setMode('chat');
      }}
      onBackendPicked={onBackendPicked}
      onModelPicked={onModelPicked}
      onQuantPicked={onQuantPicked}
      onModelPrepared={onModelPrepared}
      onModelPrepareCancel={onModelPrepareCancel}
      onToggleFavourite={onToggleFavourite}
      onThemePicked={onThemePicked}
      onModePicked={onModePicked}
      onProjectPicked={onProjectPicked}
      onTemplatePicked={onTemplatePicked}
      onProjectCreate={(title) => {
        setMode('chat');
        createAndSwitch(title);
      }}
      onProjectDelete={handleDeleteProject}
      onOverleafLink={onOverleafLink}
      onQuestionAnswer={(answer) => {
        question?.resolve(answer);
        setQuestion(null);
      }}
    />
  );
  if (mode !== 'chat' || question) return overlay;

  const modeLabel = config.mode === 'auto' ? 'hands-off ⚡' : 'hands-on 🔒';
  const focusLabel =
    focus === 'general' ? 'general' : activeProject ? activeProject.title : 'research';
  const rightStatus =
    clampedOffset > 0
      ? `↑ scrolled ${clampedOffset} · PgDn latest`
      : isLoading
        ? 'esc to interrupt · PgUp/PgDn scroll'
        : 'PgUp/PgDn scroll · enter send';

  const gapLines = Array.from({ length: INPUT_GAP }, (_, i) => <Text key={`gap${i}`}> </Text>);

  return (
    <Box flexDirection="column">
      {/* Transcript viewport: exactly viewportHeight lines, banner included so
          the header scrolls away with the conversation. Content is top-aligned;
          the input footer stays pinned at the very bottom. */}
      <Box flexDirection="column">
        {windowLines}
        {padLines}
      </Box>

      {/* Clear separation between the transcript and the input box. */}
      {gapLines}

      {pending && (
        <Box borderStyle="round" borderColor={theme.error} flexDirection="column" paddingX={1}>
          <Text bold color={theme.error}>
            Run sensitive tool: {pending.name}?
          </Text>
          <Text dimColor>{redactSecrets(pending.args)}</Text>
          <Text>
            <Text color={theme.toolResult}>[y]</Text> allow{'   '}
            <Text color={theme.tool}>[a]</Text> allow all{'   '}
            <Text color={theme.error}>[n/esc]</Text> deny
          </Text>
        </Box>
      )}

      <Box paddingX={1} justifyContent="space-between">
        <Text>
          <Text dimColor>{modeLabel}</Text>
          <Text dimColor>{'  ·  '}</Text>
          <Text color={focus === 'general' ? theme.tool : undefined} dimColor={focus !== 'general'}>
            {focusLabel}
          </Text>
        </Text>
        <Text dimColor>{rightStatus}</Text>
      </Box>

      <Box
        borderStyle="round"
        borderColor={isLoading ? theme.border : theme.borderActive}
        paddingX={1}
      >
        <Text color={theme.user}>{isLoading ? spinner : '›'} </Text>
        <InputContent value={input} cursor={cursor} cursorOn={cursorOn} accent={theme.user} />
      </Box>

      {menuActive && (
        <Box paddingX={1} flexDirection="column">
          {visibleMenuMatches.map((c, i) => {
            const active = i + menuWindowStart === menuSel;
            const color = active ? theme.user : undefined;
            return (
              <Box key={c.name}>
                <Text color={color} dimColor={!active}>
                  {active ? '❯ ' : '  '}
                  {c.name.padEnd(maxMenuNameLen)}
                  {'  '}
                </Text>
                <Box width={menuDescWidth}>
                  <Text color={color} dimColor={!active} wrap="wrap">
                    {c.desc}
                  </Text>
                </Box>
              </Box>
            );
          })}
        </Box>
      )}
    </Box>
  );
}
