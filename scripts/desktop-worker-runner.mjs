import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..");
const openclawConfigPath = process.env.OPENCLAW_CONFIG_PATH || "F:\\openclaw\\openclaw.json";

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function getPluginConfig() {
  const raw = readJsonSafe(openclawConfigPath);
  return (((raw?.plugins || {}).entries || {}).miya || {}).config || {};
}

export function resolveDesktopWorkerRuntime() {
  const pluginConfig = getPluginConfig();
  const pluginRoot = process.env.MIYA_PLUGIN_ROOT || pluginConfig.pluginRoot || root;
  const desktopWorker = pluginConfig.desktopWorker || {};
  const probe = desktopWorker.probe || {};
  return {
    root: pluginRoot,
    configPath: openclawConfigPath,
    transport: process.env.MIYA_DESKTOP_WORKER_TRANSPORT || desktopWorker.transport || "http",
    endpoint: process.env.MIYA_DESKTOP_WORKER_ENDPOINT || desktopWorker.endpoint || "http://127.0.0.1:43111",
    timeoutMs: Math.max(Number(process.env.MIYA_ACCEPTANCE_TIMEOUT_MS || process.env.MIYA_SMOKE_TIMEOUT_MS || desktopWorker.timeoutMs || 15000), 1000),
    pythonCommand: process.env.MIYA_PYTHON || probe.command || "python",
    workerPath: path.join(pluginRoot, "worker", "desktop_worker.py"),
  };
}

function buildPayload(command, args) {
  if (command === "capture") {
    return { maxEdge: Number(args[0] ?? 1280), jpegQuality: Number(args[1] ?? 60) };
  }
  if (command === "inspect_ui") {
    return { maxItems: Number(args[0] ?? 120) };
  }
  if (command === "click") {
    return {
      x: Number(args[0] ?? 0),
      y: Number(args[1] ?? 0),
      dryRun: String(args[2] ?? "false").toLowerCase() === "true",
    };
  }
  return {};
}

async function runHttp(command, args, runtime) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), runtime.timeoutMs);
  try {
    const response = await fetch(new URL(`/${command}`, runtime.endpoint).toString(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildPayload(command, args)),
      signal: controller.signal,
    });
    const raw = (await response.text()).trim();
    if (!raw) {
      return { status: response.ok ? "ok" : "error", error: `empty HTTP response (${response.status})`, command };
    }
    try {
      return JSON.parse(raw);
    } catch (error) {
      return { status: "error", error: `invalid worker json: ${error instanceof Error ? error.message : String(error)}`, raw, command };
    }
  } catch (error) {
    return { status: "error", error: error instanceof Error ? error.message : String(error), command };
  } finally {
    clearTimeout(timer);
  }
}

async function runCommand(command, args, runtime) {
  return await new Promise((resolve) => {
    const child = spawn(runtime.pythonCommand, [runtime.workerPath, command, ...args], {
      cwd: runtime.root,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      resolve({ status: "error", error: `desktop worker timed out after ${runtime.timeoutMs}ms (${command})`, command });
    }, runtime.timeoutMs);

    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ status: "error", error: error instanceof Error ? error.message : String(error), command });
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        resolve({ status: "error", error: stderr.trim() || `exit=${code}`, command });
        return;
      }
      try {
        resolve(JSON.parse(stdout.trim() || "{}"));
      } catch (error) {
        resolve({ status: "error", error: `invalid worker json: ${error instanceof Error ? error.message : String(error)}`, raw: stdout.trim(), command });
      }
    });
  });
}

function isWorkerSuccess(payload) {
  return payload?.status === "ok" || payload?.status === "pong";
}

export async function runDesktopWorker(command, args = []) {
  const runtime = resolveDesktopWorkerRuntime();
  if (runtime.transport === "command") {
    return runCommand(command, args, runtime);
  }
  const httpPayload = await runHttp(command, args, runtime);
  if (isWorkerSuccess(httpPayload)) {
    return httpPayload;
  }
  return runCommand(command, args, runtime);
}

export async function runPingWorker() {
  const runtime = resolveDesktopWorkerRuntime();
  if (runtime.transport === "command") {
    return runCommand("ping", [], runtime);
  }
  const httpPayload = await runHttp("ping", [], runtime);
  if (isWorkerSuccess(httpPayload)) {
    return httpPayload;
  }
  return runCommand("ping", [], runtime);
}
