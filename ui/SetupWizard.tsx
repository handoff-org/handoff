import React, { useState, useCallback, useEffect } from 'react';
import { Select } from './Select.js';
import { SetupFlow } from './SetupFlow.js';
import { OllamaPrepare } from './OllamaPrepare.js';
import { ModelMenu } from './ModelMenu.js';
import {
  BACKEND_OPTIONS,
  QUANT_OPTIONS,
  withQuant,
  type Backend,
  type FavouriteEntry,
} from '../config/models.js';
import { writeStore } from '../config/store.js';
import { fetchVllmModels } from '../src/agent/model.js';
import { listInstalledModels } from '../src/agent/ollama.js';
import type { Config } from '../config/schema.js';

interface Props {
  initialConfig: Config;
  onComplete: (config: Config) => void;
}

type Step = 'backend' | 'model' | 'quant' | 'token' | 'prepare' | 'personalization';

export function SetupWizard({ initialConfig, onComplete }: Props) {
  const [step, setStep] = useState<Step>('backend');
  const [config, setConfig] = useState<Config>(initialConfig);
  const [vllmModels, setVllmModels] = useState<string[]>([]);
  const [llamaCppModels, setLlamaCppModels] = useState<string[]>([]);
  const [mlxModels, setMlxModels] = useState<string[]>([]);
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [baseModelId, setBaseModelId] = useState(initialConfig.modelId);
  const [modelHasQuant, setModelHasQuant] = useState(false);
  // Config staged for completion, shown behind the final personalization opt-in.
  const [pending, setPending] = useState<Config | null>(null);

  // The last screen before entering the app: a one-time, opt-in personalization
  // prompt. Every completion path routes through here.
  const finish = useCallback((cfg: Config) => {
    setPending(cfg);
    setStep('personalization');
  }, []);

  // Fetch available models from local OpenAI-compat servers on the model step.
  useEffect(() => {
    if (config.backend === 'vllm' && step === 'model')
      fetchVllmModels(config.vllmBaseUrl)
        .then(setVllmModels)
        .catch(() => setVllmModels([]));
    if (config.backend === 'llama_cpp' && step === 'model')
      fetchVllmModels(config.llamaCppBaseUrl)
        .then(setLlamaCppModels)
        .catch(() => setLlamaCppModels([]));
    if (config.backend === 'mlx' && step === 'model')
      fetchVllmModels(config.mlxBaseUrl)
        .then(setMlxModels)
        .catch(() => setMlxModels([]));
    if (config.backend === 'ollama' && step === 'model')
      listInstalledModels(config.ollamaBaseUrl)
        .then(setOllamaModels)
        .catch(() => setOllamaModels([]));
  }, [
    config.backend,
    config.vllmBaseUrl,
    config.llamaCppBaseUrl,
    config.mlxBaseUrl,
    config.ollamaBaseUrl,
    step,
  ]);

  // Toggle a favourite during setup — same behaviour as the in-app picker so F
  // works identically before and after the wizard. Functional updater keeps it
  // free of stale-closure bugs.
  const toggleFavourite = useCallback((modelId: string) => {
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

  const chooseBackend = useCallback(
    (backend: Backend) => {
      const next = { ...config, backend };
      setConfig(next);
      void writeStore({ backend });
      setStep('model');
    },
    [config],
  );

  const chooseModel = useCallback(
    (modelId: string, hasQuant: boolean) => {
      setBaseModelId(modelId);
      setModelHasQuant(hasQuant);
      const next = { ...config, modelId };
      setConfig(next);
      if (hasQuant) {
        setStep('quant');
      } else if (next.backend === 'hf' && !next.hfToken) {
        void writeStore({ modelId });
        setStep('token');
      } else if (next.backend === 'ollama') {
        // Pull the model now (OllamaPrepare starts the server if needed).
        void writeStore({ modelId });
        setStep('prepare');
      } else {
        void writeStore({ modelId });
        finish(next);
      }
    },
    [config, finish],
  );

  const goBackToBackend = useCallback(() => setStep('backend'), []);

  const goBackToModel = useCallback(() => {
    setConfig((c) => ({ ...c, modelId: baseModelId }));
    setStep('model');
  }, [baseModelId]);

  const goBackFromPrepare = useCallback(() => {
    setConfig((c) => ({ ...c, modelId: baseModelId }));
    setStep(modelHasQuant ? 'quant' : 'model');
  }, [baseModelId, modelHasQuant]);

  const chooseQuant = useCallback(
    (quant: string) => {
      const modelId = withQuant(config.modelId, quant);
      const next = { ...config, modelId };
      setConfig(next);
      void writeStore({ modelId });
      setStep('prepare');
    },
    [config],
  );

  if (step === 'backend') {
    return (
      <Select title="Choose your backend" options={BACKEND_OPTIONS} onSelect={chooseBackend} />
    );
  }

  if (step === 'model') {
    return (
      <ModelMenu
        backend={config.backend as Backend}
        vllmModels={vllmModels}
        llamaCppModels={llamaCppModels}
        mlxModels={mlxModels}
        ollamaModels={ollamaModels}
        favourites={config.favourites as FavouriteEntry[]}
        currentModelId={config.modelId}
        onSelect={chooseModel}
        onToggleFavourite={toggleFavourite}
        onCancel={goBackToBackend}
      />
    );
  }

  if (step === 'quant') {
    return (
      <Select
        title={`Quantization for ${config.modelId}`}
        options={QUANT_OPTIONS}
        onSelect={chooseQuant}
        onCancel={goBackToModel}
      />
    );
  }

  if (step === 'token') {
    return (
      <SetupFlow
        onComplete={(token) => finish({ ...config, hfToken: token })}
        onCancel={goBackToModel}
      />
    );
  }

  if (step === 'personalization') {
    const base = pending ?? config;
    return (
      <Select
        title="Enable local personalization?"
        options={[
          {
            label: 'Yes — remember my preferences',
            value: 'yes',
            hint: 'handoff learns your stated preferences & habits, stored locally; edit or disable anytime with /profile',
          },
          {
            label: 'No — stay generic',
            value: 'no',
            hint: 'you can turn this on later in /settings',
          },
        ]}
        onSelect={(v) => {
          const enabled = v === 'yes';
          void writeStore({ personalizationEnabled: enabled });
          onComplete({ ...base, personalizationEnabled: enabled });
        }}
      />
    );
  }

  // prepare (ollama)
  return (
    <OllamaPrepare
      baseUrl={config.ollamaBaseUrl}
      model={config.modelId}
      onReady={() => finish(config)}
      onCancel={goBackFromPrepare}
    />
  );
}
