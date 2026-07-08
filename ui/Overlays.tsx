import React from 'react';
import { Box, Text } from 'ink';
import { Select } from './Select.js';
import { ThemePreview } from './ThemePreview.js';
import { OverleafLink } from './OverleafLink.js';
import { ProjectMenu } from './ProjectMenu.js';
import { Question } from './Question.js';
import { ModelMenu } from './ModelMenu.js';
import { OllamaPrepare } from './OllamaPrepare.js';
import { ContextInput } from './ContextInput.js';
import {
  BACKEND_OPTIONS,
  QUANT_OPTIONS,
  type Backend,
  type FavouriteEntry,
} from '../config/models.js';
import { listTemplates } from '../src/workspace/templateStore.js';
import { PRESET_LABELS, type InferencePreset } from '../src/agent/presets.js';
import type { Theme } from '../config/theme.js';
import type { Config } from '../config/schema.js';
import type { ProjectMeta } from '../src/workspace/project.js';

export type OverlayMode =
  | 'chat'
  | 'backend_select'
  | 'model_select'
  | 'quant_select'
  | 'model_prepare'
  | 'settings'
  | 'context_input'
  | 'kv_cache_select'
  | 'hf_consent'
  | 'theme_select'
  | 'preset_select'
  | 'personalization_select'
  | 'mode_select'
  | 'project_select'
  | 'template_select'
  | 'overleaf_link';

/** A model question awaiting the user's on-screen selection. */
export interface PendingQuestion {
  q: string;
  options: string[];
  resolve: (answer: string) => void;
}

const MODE_OPTIONS = [
  { label: 'hands-on 🔒', value: 'permissions' as const, hint: 'ask before sensitive tools' },
  { label: 'hands-off ⚡', value: 'auto' as const, hint: 'run everything automatically' },
];

const KV_CACHE_OPTIONS = [
  { label: 'q8_0  (recommended)', value: 'q8_0' as const, hint: '~half the KV memory · needs flash attention' },
  { label: 'q4_0', value: 'q4_0' as const, hint: '~quarter the memory · lower quality · needs flash attention' },
  { label: 'f16  (full)', value: 'f16' as const, hint: 'no quantization · most memory' },
];

type SettingsValue =
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
  | 'router_notes';

function settingsOptions(
  mascotOn: boolean,
  numCtx: number,
  flashOn: boolean,
  kvType: string,
  perfMode: string,
  preset: string,
  personalizationOn: boolean,
  routerEnabled: boolean,
  routerFastModelId: string,
  routerNotes: string,
): Array<{ label: string; value: SettingsValue; hint: string; separator?: boolean }> {
  return [
    {
      label: `Inference preset  (currently ${preset})`,
      value: 'preset',
      hint: 'cool / fast / balanced / deep — bundles context, output, keep-alive & prompt budget',
    },
    {
      label: `Personalization  (currently ${personalizationOn ? 'on' : 'off'})`,
      value: 'personalization',
      hint: 'local, editable profile of your preferences — nothing leaves this machine',
    },

    { label: 'Appearance', value: 'theme', hint: '', separator: true },
    { label: 'Change theme', value: 'theme', hint: 'pick a color scheme for the terminal' },
    {
      label: `Toggle mascot  (currently ${mascotOn ? 'on' : 'off'})`,
      value: 'mascot',
      hint: 'animated banner character',
    },

    { label: 'Performance', value: 'performance_mode', hint: '', separator: true },
    {
      label: `Performance mode  (currently ${perfMode})`,
      value: 'performance_mode',
      hint: 'cool = fast & cool (default) · balanced · max = allow bigger/hotter models',
    },
    {
      label: `Context window  (currently ${numCtx})`,
      value: 'context',
      hint: 'larger context can make the model much slower or force CPU offload · try 8192',
    },
    {
      label: `Flash attention  (currently ${flashOn ? 'on' : 'off'})`,
      value: 'flash_attention',
      hint: 'faster attention · applies when Ollama restarts',
    },
    {
      label: `KV cache  (currently ${kvType})`,
      value: 'kv_cache',
      hint: 'quantize the KV cache to save memory · applies when Ollama restarts',
    },

    { label: 'Model routing', value: 'router_toggle', hint: '', separator: true },
    {
      label: `Toggle routing  (${routerEnabled ? 'on' : 'off'})`,
      value: 'router_toggle',
      hint: 'auto-select fast vs think model per turn',
    },
    {
      label: `Fast model  (${routerFastModelId})`,
      value: 'router_fast_model',
      hint: 'conversational turns · no extended thinking',
    },
    {
      label: 'Think model  (main model)',
      value: 'router_think_model',
      hint: 'research / paper turns · full reasoning',
    },
    {
      label: `Routing notes  (${routerNotes})`,
      value: 'router_notes',
      hint: 'when to show the per-turn tier note: changes · always · off',
    },
  ];
}

interface Props {
  mode: OverlayMode;
  config: Config;
  theme: Theme;
  activeProject: ProjectMeta | null;
  question: PendingQuestion | null;
  vllmModels: string[];
  llamaCppModels: string[];
  mlxModels: string[];
  ollamaModels?: string[];
  /** Model id to pull in the 'model_prepare' overlay. */
  pullModelId: string;
  bannerAnimation: boolean;
  onSettingsPicked: (v: SettingsValue) => void;
  onContextPicked: (numCtx: number) => void;
  onKvCachePicked: (kvType: 'f16' | 'q8_0' | 'q4_0') => void;
  onPresetPicked: (preset: InferencePreset) => void;
  onPersonalizationPicked: (key: string) => void;
  /** Learned model prefs (from the local profile) for scoring + row badges. */
  modelPersonalization?: {
    preferredModels?: string[];
    rejectedModels?: string[];
    slowModels?: string[];
    prefersFastSmallModels?: boolean;
  };
  onHfConsent: (accepted: boolean) => void;
  onCancel: () => void;
  onBackendPicked: (backend: Backend) => void;
  onModelPicked: (modelId: string, hasQuant: boolean) => void;
  onQuantPicked: (quant: string) => void;
  /** Called when 'model_prepare' finishes pulling and the model is ready. */
  onModelPrepared: () => void;
  /** Called when the user backs out of 'model_prepare'. */
  onModelPrepareCancel: () => void;
  onToggleFavourite: (modelId: string) => void;
  onThemePicked: (name: string) => void;
  onModePicked: (m: Config['mode']) => void;
  onProjectPicked: (slug: string) => void;
  /** Chosen template key from the post-create picker ('' = set up later). */
  onTemplatePicked: (templateKey: string) => void;
  onProjectCreate: (title: string) => void;
  onProjectDelete: (slug: string) => void;
  onOverleafLink: (url: string, token: string) => void;
  onQuestionAnswer: (answer: string) => void;
}

/**
 * The full-screen modal overlays (backend/model/quant/theme/mode/project/overleaf
 * pickers and the model's ask_user question). Returns `null` when nothing is
 * open, letting `App` fall through to the chat view.
 */
export function Overlays({
  mode,
  config,
  theme,
  activeProject,
  question,
  vllmModels,
  llamaCppModels,
  mlxModels,
  ollamaModels,
  pullModelId,
  bannerAnimation,
  onSettingsPicked,
  onContextPicked,
  onKvCachePicked,
  onPresetPicked,
  onPersonalizationPicked,
  modelPersonalization,
  onHfConsent,
  onCancel,
  onBackendPicked,
  onModelPicked,
  onQuantPicked,
  onModelPrepared,
  onModelPrepareCancel,
  onToggleFavourite,
  onThemePicked,
  onModePicked,
  onProjectPicked,
  onTemplatePicked,
  onProjectCreate,
  onProjectDelete,
  onOverleafLink,
  onQuestionAnswer,
}: Props): React.ReactElement | null {
  if (mode === 'backend_select') {
    return (
      <Select
        title="Choose backend"
        options={BACKEND_OPTIONS}
        onSelect={onBackendPicked}
        onCancel={onCancel}
        theme={theme}
      />
    );
  }

  if (mode === 'model_select') {
    return (
      <ModelMenu
        backend={config.backend as Backend}
        vllmModels={vllmModels}
        llamaCppModels={llamaCppModels}
        mlxModels={mlxModels}
        ollamaModels={ollamaModels}
        favourites={config.favourites as FavouriteEntry[]}
        currentModelId={config.modelId}
        performanceMode={config.modelPerformanceMode}
        cloudConsent={config.hfConsent}
        {...(modelPersonalization?.preferredModels ? { preferredModels: modelPersonalization.preferredModels } : {})}
        {...(modelPersonalization?.rejectedModels ? { rejectedModels: modelPersonalization.rejectedModels } : {})}
        {...(modelPersonalization?.slowModels ? { slowModels: modelPersonalization.slowModels } : {})}
        {...(modelPersonalization?.prefersFastSmallModels ? { prefersFastSmallModels: true } : {})}
        onSelect={onModelPicked}
        onToggleFavourite={onToggleFavourite}
        onCancel={onCancel}
      />
    );
  }

  if (mode === 'template_select') {
    const options = [
      ...listTemplates().map((t) => ({
        label: t.label,
        value: t.key,
        hint: t.hasFolder ? 'full venue template (styles, .bst, checklist)' : 'minimal LaTeX skeleton',
      })),
      { label: 'Set up later', value: '', hint: 'skip — add a template anytime' },
    ];
    return (
      <Select
        title="Choose a paper template"
        options={options}
        onSelect={onTemplatePicked}
        onCancel={() => onTemplatePicked('')}
        theme={theme}
      />
    );
  }

  if (mode === 'quant_select') {
    return (
      <Select
        title={`Quantization for ${config.modelId}`}
        options={QUANT_OPTIONS}
        onSelect={onQuantPicked}
        onCancel={onCancel}
        theme={theme}
      />
    );
  }

  if (mode === 'model_prepare') {
    return (
      <OllamaPrepare
        baseUrl={config.ollamaBaseUrl}
        model={pullModelId}
        flashAttention={config.ollamaFlashAttention}
        kvCacheType={config.ollamaKvCacheType}
        onReady={onModelPrepared}
        onCancel={onModelPrepareCancel}
      />
    );
  }

  if (mode === 'settings') {
    return (
      <Select
        title="Settings"
        options={settingsOptions(
          bannerAnimation,
          config.ollamaNumCtx,
          config.ollamaFlashAttention,
          config.ollamaKvCacheType,
          config.modelPerformanceMode,
          config.inferencePreset,
          config.personalizationEnabled,
          config.routerEnabled ?? false,
          config.routerFastModelId ?? 'qwen3:4b',
          config.routerNotes ?? 'changes',
        )}
        onSelect={onSettingsPicked}
        onCancel={onCancel}
        theme={theme}
      />
    );
  }

  if (mode === 'preset_select') {
    const order: InferencePreset[] = ['cool', 'fast', 'balanced', 'deep', 'long_context', 'manual'];
    return (
      <Select
        title="Inference preset (context · output · keep-alive · prompt budget)"
        options={order.map((p) => ({
          label: PRESET_LABELS[p].label + (p === config.inferencePreset ? '  (current)' : ''),
          value: p,
          hint: PRESET_LABELS[p].hint,
        }))}
        onSelect={onPresetPicked}
        onCancel={onCancel}
        theme={theme}
      />
    );
  }

  if (mode === 'personalization_select') {
    const onOff = (b: boolean) => (b ? 'on' : 'off');
    return (
      <Select
        title="Personalization (local profile — nothing leaves this machine)"
        options={[
          {
            label: `Personalization  (${onOff(config.personalizationEnabled)})`,
            value: 'enabled',
            hint: 'learn and apply your stated preferences & habits',
          },
          {
            label: `Include in model prompt  (${onOff(config.personalizationIncludeInPrompt)})`,
            value: 'include_prompt',
            hint: 'add a compact preferences block to the system prompt',
          },
          {
            label: `Include in CLOUD prompts  (${onOff(config.personalizationAllowCloudPrompt)})`,
            value: 'allow_cloud',
            hint: 'off by default — only send the profile to cloud models if you turn this on',
          },
          {
            label: `Learn from projects  (${onOff(config.personalizationLearnFromProjects)})`,
            value: 'learn_projects',
            hint: 'notice recurring templates / project patterns',
          },
          {
            label: `Learn from performance  (${onOff(config.personalizationLearnFromPerformance)})`,
            value: 'learn_performance',
            hint: 'remember which models ran well or hot on this machine',
          },
          { label: 'Reset profile…', value: 'reset', hint: 'clear everything learned (backs up first)' },
          { label: 'View profile  (/profile show)', value: 'show', hint: 'print what has been learned' },
        ]}
        onSelect={onPersonalizationPicked}
        onCancel={onCancel}
        theme={theme}
      />
    );
  }

  if (mode === 'kv_cache_select') {
    return (
      <Select
        title="KV cache type (applies when Ollama restarts)"
        options={KV_CACHE_OPTIONS}
        onSelect={onKvCachePicked}
        onCancel={onCancel}
        theme={theme}
      />
    );
  }

  if (mode === 'hf_consent') {
    return (
      <Box flexDirection="column" padding={1} gap={1}>
        <Text bold color={theme.error}>
          Send your data to the HuggingFace cloud?
        </Text>
        <Box flexDirection="column">
          <Text>The HuggingFace backend runs models on HuggingFace&apos;s servers. Your prompts,</Text>
          <Text>project context, and tool output will leave this machine. It is the only</Text>
          <Text>backend that is not fully local.</Text>
        </Box>
        <Select
          title="Proceed?"
          options={[
            { label: 'Yes — send to HuggingFace cloud', value: 'yes', hint: 'remembered for future sessions' },
            { label: 'No — keep everything local', value: 'no', hint: 'cancel; pick a local backend with /model' },
          ]}
          onSelect={(v) => onHfConsent(v === 'yes')}
          onCancel={() => onHfConsent(false)}
          theme={theme}
        />
      </Box>
    );
  }

  if (mode === 'context_input') {
    return (
      <ContextInput
        theme={theme}
        current={config.ollamaNumCtx}
        onSubmit={onContextPicked}
        onCancel={onCancel}
      />
    );
  }

  if (mode === 'theme_select') {
    return (
      <ThemePreview
        current={config.theme}
        backend={config.backend}
        modelId={config.modelId}
        mode={config.mode}
        onSelect={onThemePicked}
        onCancel={onCancel}
      />
    );
  }

  if (mode === 'mode_select') {
    return (
      <Select
        title="Permission mode"
        options={MODE_OPTIONS}
        onSelect={onModePicked}
        onCancel={onCancel}
        theme={theme}
      />
    );
  }

  if (mode === 'project_select') {
    return (
      <ProjectMenu
        theme={theme}
        {...(activeProject ? { activeSlug: activeProject.slug } : {})}
        onSwitch={onProjectPicked}
        onCreate={onProjectCreate}
        onDelete={onProjectDelete}
        onCancel={onCancel}
      />
    );
  }

  if (mode === 'overleaf_link') {
    return <OverleafLink theme={theme} onSubmit={onOverleafLink} onCancel={onCancel} />;
  }

  if (question) {
    return (
      <Question
        theme={theme}
        question={question.q}
        options={question.options}
        onAnswer={onQuestionAnswer}
      />
    );
  }

  return null;
}
