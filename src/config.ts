import path from "node:path";

export type MiyaFeatureFlags = {
  probeCommand?: boolean;
  workerHealthCommand?: boolean;
  capabilitiesCommand?: boolean;
  memoryLite?: boolean;
  personaLite?: boolean;
  voiceLite?: boolean;
  vramScheduler?: boolean;
  wizard?: boolean;
};

export type MiyaDesktopWorkerConfig = {
  enabled?: boolean;
  transport?: "http" | "command";
  endpoint?: string;
  timeoutMs?: number;
  probe?: {
    mode?: "http" | "command" | "none";
    path?: string;
    method?: "GET" | "POST";
    command?: string;
    args?: string[];
    expectedStatus?: number;
  };
};

export type MiyaDesktopRunConfig = {
  enabled?: boolean;
  defaultConfirm?: boolean;
  persistRuns?: boolean;
  defaultMaxAttempts?: number;
};

export type MiyaMemoryLiteConfig = {
  enabled?: boolean;
  provider?: "core-memory" | "local-embedding" | "none";
  collection?: string;
  maxRecallItems?: number;
  fallbackStrategy?: "identity-only" | "core-only";
};

export type MiyaPersonaLiteConfig = {
  enabled?: boolean;
  profileName?: string;
  styleTags?: string[];
  referenceImageDir?: string;
  injectionMode?: "static" | "core-system" | "none";
  fallbackStrategy?: "static-summary" | "identity-only";
};

export type MiyaVoiceRuntimeConfig = {
  enabled?: boolean;
  provider?: "external-worker" | "manual" | "none";
  modelPath?: string;
  sampleRate?: number;
};

export type MiyaVoiceConfig = {
  enabled?: boolean;
  vad?: MiyaVoiceRuntimeConfig;
  asr?: MiyaVoiceRuntimeConfig;
  tts?: MiyaVoiceRuntimeConfig & { voiceId?: string };
  speakerId?: MiyaVoiceRuntimeConfig;
};

export type MiyaVramLane = {
  lane: "interactive" | "voice" | "vision" | "image" | "training";
  priority?: number;
  maxModels?: number;
  estimatedVramMb?: number;
  evictable?: boolean;
};

export type MiyaVramSchedulerConfig = {
  enabled?: boolean;
  strategy?: "manual-lanes" | "none";
  defaultLane?: MiyaVramLane["lane"];
  gpuIndex?: number;
  minFreeMb?: number;
  telemetryCommand?: string;
  telemetryArgs?: string[];
  lanes?: MiyaVramLane[];
  allowForceEvict?: boolean;
  fragmentationSlackMb?: number;
  evictionCommand?: string;
  evictionArgs?: string[];
  defragCommand?: string;
  defragArgs?: string[];
};

export type MiyaTrainerProfileConfig = {
  enabled?: boolean;
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  artifactGlobs?: string[];
};

export type MiyaVisionRuntimeConfig = {
  enabled?: boolean;
  provider?: "auto" | "sidecar" | "command" | "none";
  command?: string;
  args?: string[];
  pythonCommand?: string;
  sidecarPath?: string;
  modelPath?: string;
  runtimeRoot?: string;
  binaryPath?: string;
  mmprojPath?: string;
  gpuLayers?: number;
  timeoutMs?: number;
};

export type MiyaImageRuntimeConfig = {
  enabled?: boolean;
  provider?: "sidecar" | "python" | "none";
  pythonCommand?: string;
  sidecarPath?: string;
  modelPreference?: "fast" | "balanced";
  timeoutMs?: number;
};

export type MiyaWizardConfig = {
  enabled?: boolean;
  workspaceDir?: string;
  datasetDir?: string;
  outputDir?: string;
  trainer?: {
    lora?: MiyaTrainerProfileConfig;
    finetune?: MiyaTrainerProfileConfig;
  };
};

export type MiyaPluginConfig = {
  enabled?: boolean;
  stateRoot?: string;
  pluginRoot?: string;
  modelRoot?: string;
  desktopWorker?: MiyaDesktopWorkerConfig;
  desktopRun?: MiyaDesktopRunConfig;
  features?: MiyaFeatureFlags;
  memoryLite?: MiyaMemoryLiteConfig;
  personaLite?: MiyaPersonaLiteConfig;
  voice?: MiyaVoiceConfig;
  vramScheduler?: MiyaVramSchedulerConfig;
  vision?: MiyaVisionRuntimeConfig;
  image?: MiyaImageRuntimeConfig;
  wizard?: MiyaWizardConfig;
};

export function resolveFeatureFlags(config?: MiyaPluginConfig) {
  return {
    probeCommand: config?.features?.probeCommand ?? true,
    workerHealthCommand: config?.features?.workerHealthCommand ?? true,
    capabilitiesCommand: config?.features?.capabilitiesCommand ?? true,
    memoryLite: config?.features?.memoryLite ?? false,
    personaLite: config?.features?.personaLite ?? false,
    voiceLite: config?.features?.voiceLite ?? false,
    vramScheduler: config?.features?.vramScheduler ?? false,
    wizard: config?.features?.wizard ?? false,
  };
}

export function resolveDesktopWorkerConfig(config?: MiyaPluginConfig) {
  return {
    enabled: config?.desktopWorker?.enabled ?? false,
    transport: config?.desktopWorker?.transport ?? "http",
    endpoint: config?.desktopWorker?.endpoint ?? "http://127.0.0.1:43111",
    timeoutMs: config?.desktopWorker?.timeoutMs ?? 3000,
    probe: {
      mode: config?.desktopWorker?.probe?.mode ?? "http",
      path: config?.desktopWorker?.probe?.path ?? "/health",
      method: config?.desktopWorker?.probe?.method ?? "GET",
      command: config?.desktopWorker?.probe?.command ?? "",
      args: config?.desktopWorker?.probe?.args ?? [],
      expectedStatus: config?.desktopWorker?.probe?.expectedStatus ?? 200,
    },
  };
}

export function resolveDesktopRunConfig(config?: MiyaPluginConfig) {
  return {
    enabled: config?.desktopRun?.enabled ?? true,
    defaultConfirm: config?.desktopRun?.defaultConfirm ?? true,
    persistRuns: config?.desktopRun?.persistRuns ?? true,
    defaultMaxAttempts: Math.max(config?.desktopRun?.defaultMaxAttempts ?? 1, 1),
  };
}

export function resolveMemoryLiteConfig(config?: MiyaPluginConfig) {
  return {
    enabled: config?.memoryLite?.enabled ?? false,
    provider: config?.memoryLite?.provider ?? "core-memory",
    collection: config?.memoryLite?.collection ?? "miya-memory-lite",
    maxRecallItems: config?.memoryLite?.maxRecallItems ?? 4,
    fallbackStrategy: config?.memoryLite?.fallbackStrategy ?? "identity-only",
  };
}

export function resolvePersonaLiteConfig(config?: MiyaPluginConfig) {
  const pluginRoot = config?.pluginRoot?.trim() || "F:\\openclaw\\miya";
  return {
    enabled: config?.personaLite?.enabled ?? false,
    profileName: config?.personaLite?.profileName ?? "miya-default",
    styleTags: config?.personaLite?.styleTags ?? ["sweet", "playful", "clingy-lite"],
    referenceImageDir: config?.personaLite?.referenceImageDir ?? path.join(pluginRoot, "model", "image", "long_term"),
    injectionMode: config?.personaLite?.injectionMode ?? "static",
    fallbackStrategy: config?.personaLite?.fallbackStrategy ?? "static-summary",
  };
}

export function resolveVoiceConfig(config?: MiyaPluginConfig) {
  return {
    enabled: config?.voice?.enabled ?? false,
    vad: {
      enabled: config?.voice?.vad?.enabled ?? false,
      provider: config?.voice?.vad?.provider ?? "manual",
      modelPath: config?.voice?.vad?.modelPath ?? "",
      sampleRate: config?.voice?.vad?.sampleRate ?? 16000,
    },
    asr: {
      enabled: config?.voice?.asr?.enabled ?? false,
      provider: config?.voice?.asr?.provider ?? "manual",
      modelPath: config?.voice?.asr?.modelPath ?? "",
      sampleRate: config?.voice?.asr?.sampleRate ?? 16000,
    },
    tts: {
      enabled: config?.voice?.tts?.enabled ?? false,
      provider: config?.voice?.tts?.provider ?? "manual",
      modelPath: config?.voice?.tts?.modelPath ?? "",
      sampleRate: config?.voice?.tts?.sampleRate ?? 24000,
      voiceId: config?.voice?.tts?.voiceId ?? "Vivian",
    },
    speakerId: {
      enabled: config?.voice?.speakerId?.enabled ?? false,
      provider: config?.voice?.speakerId?.provider ?? "manual",
      modelPath: config?.voice?.speakerId?.modelPath ?? "",
      sampleRate: config?.voice?.speakerId?.sampleRate ?? 16000,
    },
  };
}

export function resolveVramSchedulerConfig(config?: MiyaPluginConfig) {
  return {
    enabled: config?.vramScheduler?.enabled ?? false,
    strategy: config?.vramScheduler?.strategy ?? "manual-lanes",
    defaultLane: config?.vramScheduler?.defaultLane ?? "interactive",
    gpuIndex: Math.max(config?.vramScheduler?.gpuIndex ?? 0, 0),
    minFreeMb: Math.max(config?.vramScheduler?.minFreeMb ?? 1024, 0),
    telemetryCommand: config?.vramScheduler?.telemetryCommand?.trim() || "nvidia-smi",
    telemetryArgs: config?.vramScheduler?.telemetryArgs ?? [],
    allowForceEvict: config?.vramScheduler?.allowForceEvict ?? false,
    fragmentationSlackMb: Math.max(config?.vramScheduler?.fragmentationSlackMb ?? 512, 0),
    evictionCommand: config?.vramScheduler?.evictionCommand?.trim() || "",
    evictionArgs: config?.vramScheduler?.evictionArgs ?? [],
    defragCommand: config?.vramScheduler?.defragCommand?.trim() || "",
    defragArgs: config?.vramScheduler?.defragArgs ?? [],
    lanes: config?.vramScheduler?.lanes ?? [
      { lane: "interactive", priority: 100, maxModels: 1, estimatedVramMb: 2048, evictable: false },
      { lane: "voice", priority: 90, maxModels: 2, estimatedVramMb: 4096, evictable: false },
      { lane: "vision", priority: 70, maxModels: 1, estimatedVramMb: 6144, evictable: true },
      { lane: "image", priority: 50, maxModels: 1, estimatedVramMb: 12288, evictable: true },
      { lane: "training", priority: 20, maxModels: 1, estimatedVramMb: 16384, evictable: true },
    ],
  };
}

export function resolveVisionRuntimeConfig(config?: MiyaPluginConfig) {
  const pluginRoot = config?.pluginRoot?.trim() || "F:\\openclaw\\miya";
  const modelRoot = config?.modelRoot?.trim() || path.join(pluginRoot, "model");
  return {
    enabled: config?.vision?.enabled ?? true,
    provider: config?.vision?.provider ?? "auto",
    command: config?.vision?.command?.trim() ?? "",
    args: config?.vision?.args ?? [],
    pythonCommand: config?.vision?.pythonCommand?.trim() || config?.desktopWorker?.probe?.command?.trim() || "python",
    sidecarPath: config?.vision?.sidecarPath?.trim() || path.join(pluginRoot, "worker", "vision_sidecar.py"),
    modelPath: config?.vision?.modelPath?.trim() || path.join(modelRoot, "vision", "qwen3vl_4b_instruct_q4_k_m"),
    runtimeRoot: config?.vision?.runtimeRoot?.trim() || path.join(pluginRoot, "runtime", "vision", "llama.cpp"),
    binaryPath: config?.vision?.binaryPath?.trim() || "",
    mmprojPath: config?.vision?.mmprojPath?.trim() || "",
    gpuLayers: Math.max(config?.vision?.gpuLayers ?? 99, 0),
    timeoutMs: Math.max(config?.vision?.timeoutMs ?? 60000, 1000),
  };
}

export function resolveImageRuntimeConfig(config?: MiyaPluginConfig) {
  const pluginRoot = config?.pluginRoot?.trim() || "F:\\openclaw\\miya";
  return {
    enabled: config?.image?.enabled ?? true,
    provider: config?.image?.provider ?? "sidecar",
    pythonCommand: config?.image?.pythonCommand?.trim() || config?.desktopWorker?.probe?.command?.trim() || "python",
    sidecarPath: config?.image?.sidecarPath?.trim() || path.join(pluginRoot, "worker", "image_sidecar.py"),
    modelPreference: config?.image?.modelPreference ?? "balanced",
    timeoutMs: Math.max(config?.image?.timeoutMs ?? 180000, 1000),
  };
}

export function resolveWizardConfig(config?: MiyaPluginConfig) {
  const pluginRoot = config?.pluginRoot?.trim() || "F:\\openclaw\\miya";
  return {
    enabled: config?.wizard?.enabled ?? false,
    workspaceDir: config?.wizard?.workspaceDir ?? path.join(pluginRoot, "state", "wizard"),
    datasetDir: config?.wizard?.datasetDir ?? path.join(pluginRoot, "state", "wizard", "datasets"),
    outputDir: config?.wizard?.outputDir ?? path.join(pluginRoot, "state", "wizard", "jobs"),
    trainer: {
      lora: {
        enabled: config?.wizard?.trainer?.lora?.enabled ?? false,
        command: config?.wizard?.trainer?.lora?.command?.trim() || "",
        args: config?.wizard?.trainer?.lora?.args ?? [],
        cwd: config?.wizard?.trainer?.lora?.cwd?.trim() || "",
        env: config?.wizard?.trainer?.lora?.env ?? {},
        artifactGlobs: config?.wizard?.trainer?.lora?.artifactGlobs ?? ["**/*.safetensors", "**/*.bin", "**/*.json"],
      },
      finetune: {
        enabled: config?.wizard?.trainer?.finetune?.enabled ?? false,
        command: config?.wizard?.trainer?.finetune?.command?.trim() || "",
        args: config?.wizard?.trainer?.finetune?.args ?? [],
        cwd: config?.wizard?.trainer?.finetune?.cwd?.trim() || "",
        env: config?.wizard?.trainer?.finetune?.env ?? {},
        artifactGlobs: config?.wizard?.trainer?.finetune?.artifactGlobs ?? ["**/*.safetensors", "**/*.bin", "**/*.json"],
      },
    },
  };
}
