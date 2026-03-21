import { promises as fs } from "node:fs";
import path from "node:path";
import { resolveMiyaPaths, DEFAULT_PLUGIN_ROOT } from "./paths.ts";
import type { MiyaPluginConfig } from "./config.ts";

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

export async function readRuntimeState(config?: MiyaPluginConfig): Promise<MiyaRuntimeState> {
  const stateFile = getStateFile(config);
  try {
    const raw = await fs.readFile(stateFile, "utf8");
    return JSON.parse(raw) as MiyaRuntimeState;
  } catch {
    return { updatedAt: new Date(0).toISOString() };
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
  await fs.mkdir(path.dirname(stateFile), { recursive: true });
  await fs.writeFile(stateFile, JSON.stringify(next, null, 2), "utf8");
  return next;
}
