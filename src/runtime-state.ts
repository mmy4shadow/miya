import { promises as fs } from "node:fs";
import path from "node:path";
import { resolveMiyaPaths, DEFAULT_PLUGIN_ROOT } from "./paths.ts";
import type { MiyaPluginConfig } from "./config.ts";

const EMPTY_RUNTIME_STATE_UPDATED_AT = new Date(0).toISOString();

export type OrchestrationGovernorState = {
  updatedAt?: string;
  recentWakeByKey?: Record<string, number>;
  recentWakeBySession?: Record<string, {
    at: number;
    hook?: string;
    taskId?: string;
    routeKind?: string;
    routeSource?: string;
  }>;
};

export type MiyaRuntimeState = {
  updatedAt: string;
  promptProbe?: {
    updatedAt: string;
    matched: boolean;
    marker: string;
    promptPreview: string;
    systemPreview: string;
    charCount?: number;
    truncated?: boolean;
    provider?: string;
    model?: string;
    runId?: string;
    sessionId?: string;
  };
  pingProbe?: {
    updatedAt: string;
    ok: boolean;
    workerMode: "mock" | "python-worker" | "error";
    payload?: Record<string, unknown>;
    error?: string;
  };
  desktopCaptureProbe?: {
    updatedAt: string;
    ok: boolean;
    payload?: Record<string, unknown>;
    error?: string;
  };
  desktopInspectProbe?: {
    updatedAt: string;
    ok: boolean;
    payload?: Record<string, unknown>;
    error?: string;
  };
  desktopClickProbe?: {
    updatedAt: string;
    ok: boolean;
    payload?: Record<string, unknown>;
    error?: string;
  };
  workerHealthProbe?: {
    updatedAt: string;
    ok: boolean;
    payload?: Record<string, unknown>;
    error?: string;
  };
  diagnosticsProbe?: {
    updatedAt: string;
    ok: boolean;
    payload?: Record<string, unknown>;
    error?: string;
  };
  awakeProbe?: {
    updatedAt: string;
    ok: boolean;
    completed?: string[];
    failedStep?: string;
    payload?: Record<string, unknown>;
    error?: string;
  };
  desktopRunProbe?: {
    updatedAt: string;
    ok: boolean;
    runId: string;
    goal: string;
    strategy: string;
    runFile?: string;
    payload?: Record<string, unknown>;
    error?: string;
  };
  voiceProbe?: {
    updatedAt: string;
    ok: boolean;
    action: string;
    code?: string;
    artifactPath?: string;
    payload?: Record<string, unknown>;
    error?: string;
  };
  imageProbe?: {
    updatedAt: string;
    ok: boolean;
    code?: string;
    artifactPath?: string;
    payload?: Record<string, unknown>;
    error?: string;
  };
  wizardProbe?: {
    updatedAt: string;
    ok: boolean;
    action: string;
    jobId?: string;
    artifactPath?: string;
    payload?: Record<string, unknown>;
    error?: string;
  };
  dispatcherProbe?: {
    updatedAt: string;
    ok: boolean;
    payload?: Record<string, unknown>;
    error?: string;
  };
  workloopHook?: {
    updatedAt: string;
    hook: string;
    sessionKey?: string;
    sessionId?: string;
    trigger?: string;
    decision?: string;
    taskId?: string;
    summary?: string;
    nextAction?: string;
    payload?: Record<string, unknown>;
    error?: string;
  };
  continuationWake?: {
    updatedAt: string;
    hook: string;
    sessionKey?: string;
    taskId?: string;
    taskStatus?: string;
    routeKind?: string;
    routeSource?: string;
    enqueued?: boolean;
    wakeRequested?: boolean;
    reason?: string;
    text?: string;
    error?: string;
  };
  orchestrationGovernor?: OrchestrationGovernorState;
};

function getStateFile(config?: MiyaPluginConfig) {
  const paths = resolveMiyaPaths(config);
  return path.join(paths.pluginRoot || DEFAULT_PLUGIN_ROOT, "state", "runtime-state.json");
}

function makeEmptyRuntimeState(): MiyaRuntimeState {
  return { updatedAt: EMPTY_RUNTIME_STATE_UPDATED_AT };
}

function makeCorruptStateFile(stateFile: string) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const stateDir = path.dirname(stateFile);
  return path.join(stateDir, `runtime-state.corrupt-${stamp}.json`);
}

export async function readRuntimeState(config?: MiyaPluginConfig): Promise<MiyaRuntimeState> {
  const stateFile = getStateFile(config);
  let raw: string;
  try {
    raw = await fs.readFile(stateFile, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
      return makeEmptyRuntimeState();
    }
    throw error;
  }

  try {
    return JSON.parse(raw) as MiyaRuntimeState;
  } catch {
    try {
      const corruptFile = makeCorruptStateFile(stateFile);
      await fs.mkdir(path.dirname(stateFile), { recursive: true });
      await fs.rename(stateFile, corruptFile);
    } catch {
      // Best effort quarantine only; the caller still gets a safe empty state.
    }
    return makeEmptyRuntimeState();
  }
}

export async function updateRuntimeState(
  patch: Partial<MiyaRuntimeState>,
  config?: MiyaPluginConfig,
): Promise<MiyaRuntimeState> {
  const stateFile = getStateFile(config);
  const current = await readRuntimeState(config);
  const next: MiyaRuntimeState = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  const stateDir = path.dirname(stateFile);
  const tempFile = path.join(stateDir, `runtime-state.${process.pid}.${Date.now()}.tmp`);
  await fs.mkdir(stateDir, { recursive: true });
  try {
    await fs.writeFile(tempFile, JSON.stringify(next, null, 2), "utf8");
    await fs.rename(tempFile, stateFile);
    return next;
  } catch (error) {
    try {
      await fs.rm(tempFile, { force: true });
    } catch {
      // Best effort temp cleanup only; preserve original failure.
    }
    throw error;
  }
}
