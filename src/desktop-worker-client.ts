import { spawn } from "node:child_process";
import path from "node:path";
import type { MiyaPluginConfig } from "./config.ts";
import { resolveDesktopWorkerConfig } from "./config.ts";
import { resolveMiyaPaths } from "./paths.ts";

export type DesktopWorkerCommand =
  | "ping"
  | "capture"
  | "inspect_ui"
  | "click"
  | "activate_window"
  | "press_key"
  | "hotkey"
  | "type_text";

function buildLocalArgs(command: DesktopWorkerCommand, params: Record<string, unknown>) {
  if (command === "ping") {
    return [];
  }
  if (command === "capture") {
    return [String(params.maxEdge ?? 1280), String(params.jpegQuality ?? 60)];
  }
  if (command === "inspect_ui") {
    return [String(params.maxItems ?? 120)];
  }
  if (command === "activate_window") {
    return [String(params.title ?? "")];
  }
  if (command === "press_key") {
    return [
      String(params.key ?? ""),
      String(Boolean(params.dryRun)),
    ];
  }
  if (command === "hotkey") {
    const keys = Array.isArray(params.keys)
      ? params.keys.map((value) => String(value))
      : String(params.keys ?? "")
        .split(/[+,]/g)
        .map((value) => value.trim())
        .filter(Boolean);
    return [
      JSON.stringify(keys),
      String(Boolean(params.dryRun)),
    ];
  }
  if (command === "type_text") {
    return [
      String(params.text ?? ""),
      String(Boolean(params.dryRun)),
    ];
  }
  return [
    String(params.x ?? 0),
    String(params.y ?? 0),
    String(Boolean(params.dryRun)),
  ];
}

async function runDesktopWorkerHttp(
  command: DesktopWorkerCommand,
  params: Record<string, unknown>,
  config?: MiyaPluginConfig,
): Promise<Record<string, unknown>> {
  const worker = resolveDesktopWorkerConfig(config);
  const baseUrl = worker.endpoint?.trim();
  if (!baseUrl) {
    throw new Error("desktop worker endpoint is empty");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(worker.timeoutMs, 15000));

  try {
    const response = await fetch(new URL(`/${command}`, baseUrl).toString(), {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(params),
      signal: controller.signal,
    });

    const text = await response.text();
    let payload: Record<string, unknown> = {};
    if (text.trim()) {
      try {
        payload = JSON.parse(text) as Record<string, unknown>;
      } catch (error) {
        throw new Error(`invalid desktop worker json: ${error instanceof Error ? error.message : String(error)} | raw=${text.trim()}`);
      }
    }

    if (!response.ok) {
      const detail = typeof payload?.error === "string" ? payload.error : `HTTP ${response.status}`;
      throw new Error(detail);
    }

    return payload;
  } finally {
    clearTimeout(timer);
  }
}

async function runDesktopWorkerCommand(
  command: DesktopWorkerCommand,
  params: Record<string, unknown>,
  config?: MiyaPluginConfig,
): Promise<Record<string, unknown>> {
  const worker = resolveDesktopWorkerConfig(config);
  const paths = resolveMiyaPaths(config);
  const scriptPath = path.join(paths.pluginRoot, "worker", "desktop_worker.py");
  const pythonCommand = worker.probe.command?.trim() || "python";
  const args = buildLocalArgs(command, params);

  return new Promise((resolve, reject) => {
    const child = spawn(pythonCommand, [scriptPath, command, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
      cwd: paths.pluginRoot,
    });

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`desktop worker timed out after ${worker.timeoutMs}ms (${command})`));
    }, Math.max(worker.timeoutMs, 15000));

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(stderr.trim() || `desktop worker exited with code ${code}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout.trim() || "{}") as Record<string, unknown>);
      } catch (error) {
        reject(new Error(`invalid desktop worker json: ${error instanceof Error ? error.message : String(error)} | raw=${stdout.trim()}`));
      }
    });
  });
}

export async function executeDesktopWorkerAction(
  command: DesktopWorkerCommand,
  params: Record<string, unknown>,
  config?: MiyaPluginConfig,
): Promise<Record<string, unknown>> {
  const worker = resolveDesktopWorkerConfig(config);
  if (worker.transport === "command") {
    return runDesktopWorkerCommand(command, params, config);
  }

  try {
    return await runDesktopWorkerHttp(command, params, config);
  } catch {
    return runDesktopWorkerCommand(command, params, config);
  }
}
