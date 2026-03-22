import { spawn } from "node:child_process";
import { resolveDesktopWorkerConfig, type MiyaPluginConfig } from "./config.ts";
import { resolveMiyaPaths } from "./paths.ts";

export type WorkerProbeTarget = {
  transport: "http" | "command";
  endpoint: string;
  mode: "http" | "command" | "none";
  path: string;
  method: "GET" | "POST";
  command: string;
  args: string[];
  timeoutMs: number;
  expectedStatus: number;
};

export type WorkerHealthStatus = {
  ok: boolean;
  state: "disabled" | "skipped" | "healthy" | "unhealthy" | "error";
  target: string;
  detail: string;
  statusCode?: number;
  elapsedMs?: number;
  observedAt: string;
};

export function createWorkerProbeTarget(config?: MiyaPluginConfig): WorkerProbeTarget {
  const worker = resolveDesktopWorkerConfig(config);
  const paths = resolveMiyaPaths(config);
  const command = worker.probe.command?.trim() || "python";
  const args = worker.probe.args?.length
    ? worker.probe.args
    : [paths.pluginRoot ? `${paths.pluginRoot}\\worker\\ping_worker.py` : "worker\\ping_worker.py", "ping"];
  return {
    transport: worker.transport,
    endpoint: worker.endpoint,
    mode: worker.probe.mode,
    path: worker.probe.path,
    method: worker.probe.method,
    command,
    args,
    timeoutMs: worker.timeoutMs,
    expectedStatus: worker.probe.expectedStatus,
  };
}

export async function probeWorkerHealth(config?: MiyaPluginConfig): Promise<WorkerHealthStatus> {
  const worker = resolveDesktopWorkerConfig(config);
  const target = createWorkerProbeTarget(config);
  const observedAt = new Date().toISOString();

  if (!worker.enabled) {
    return {
      ok: false,
      state: "disabled",
      target: worker.endpoint,
      detail: "desktop worker disabled in plugin config",
      observedAt,
    };
  }

  if (target.mode === "none") {
    return {
      ok: false,
      state: "skipped",
      target: worker.endpoint,
      detail: "probe.mode=none; worker probe intentionally skipped",
      observedAt,
    };
  }

  if (target.mode === "command") {
    return probeCommandHealth(target, observedAt);
  }

  return probeHttpHealth(target, observedAt);
}

async function probeHttpHealth(target: WorkerProbeTarget, observedAt: string): Promise<WorkerHealthStatus> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), target.timeoutMs);
  const url = new URL(target.path, target.endpoint).toString();

  try {
    const response = await fetch(url, {
      method: target.method,
      signal: controller.signal,
    });
    return {
      ok: response.status === target.expectedStatus,
      state: response.status === target.expectedStatus ? "healthy" : "unhealthy",
      target: url,
      detail: `HTTP ${response.status}`,
      statusCode: response.status,
      elapsedMs: Date.now() - started,
      observedAt,
    };
  } catch (error) {
    return {
      ok: false,
      state: "error",
      target: url,
      detail: error instanceof Error ? error.message : String(error),
      elapsedMs: Date.now() - started,
      observedAt,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function probeCommandHealth(target: WorkerProbeTarget, observedAt: string): Promise<WorkerHealthStatus> {
  if (!target.command) {
    return {
      ok: false,
      state: "error",
      target: "command:<missing>",
      detail: "desktopWorker.probe.command is empty",
      observedAt,
    };
  }

  const started = Date.now();
  const commandTarget = `${target.command} ${target.args.join(" ")}`.trim();

  return new Promise((resolve) => {
    const child = spawn(target.command, target.args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderr = "";
    let stdout = "";
    let settled = false;
    const finish = (result: WorkerHealthStatus) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      child.kill();
      finish({
        ok: false,
        state: "error",
        target: commandTarget,
        detail: `command probe timed out after ${target.timeoutMs}ms`,
        elapsedMs: Date.now() - started,
        observedAt,
      });
    }, target.timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("exit", (code) => {
      finish({
        ok: code === 0,
        state: code === 0 ? "healthy" : "unhealthy",
        target: commandTarget,
        detail: [stdout.trim(), stderr.trim(), `exit=${code}`].filter(Boolean).join(" | "),
        elapsedMs: Date.now() - started,
        observedAt,
      });
    });

    child.on("error", (error) => {
      finish({
        ok: false,
        state: "error",
        target: commandTarget,
        detail: error.message,
        elapsedMs: Date.now() - started,
        observedAt,
      });
    });
  });
}
