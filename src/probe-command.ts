import { spawn } from "node:child_process";
import path from "node:path";
import { resolveDesktopWorkerConfig, resolveFeatureFlags, type MiyaPluginConfig } from "./config.ts";
import { collectDiagnostics } from "./diagnostics.ts";
import { resolveMiyaPaths } from "./paths.ts";
import { updateRuntimeState } from "./runtime-state.ts";
import { buildWorkflowContractSnapshot } from "./workflow-contract.ts";
import { buildWorkflowStatusPayload } from "./workflow-state.ts";
import {
  buildWorkflowStopPatch,
  createWorkflowTaskFromInput,
  parseWorkflowCheckInput,
  parseWorkflowStopInput,
  resolveWorkflowStopTarget,
  selectWorkflowTasksForCheck,
} from "./workflow-commands.ts";
import { findWorkflowTaskById, listWorkflowTasks, updateWorkflowTaskStatus, type MiyaWorkflowQueueEntry } from "./workflow-queue.ts";
import { renderWorkflowTaskCollection, renderWorkflowTaskDetail } from "./workflow-render.ts";
import { buildDefaultWorkflowStartInput, parseWorkflowStartInput } from "./workflow-start-parser.ts";

type CommandContext = {
  config?: Record<string, unknown>;
  args?: string;
};

function getPluginConfig(ctx: { config?: Record<string, unknown> }): MiyaPluginConfig {
  return ((ctx?.config as any)?.plugins?.entries?.miya?.config ?? {}) as MiyaPluginConfig;
}

function getCommandArgs(ctx: CommandContext) {
  return String(ctx?.args ?? "").trim();
}

function formatLines(title: string, lines: string[]) {
  return [title, ...lines].join("\n");
}

function registerAliasCommand(
  api: any,
  names: string[],
  description: string,
  handler: (ctx: CommandContext) => Promise<{ text: string }>,
) {
  for (const name of names) {
    api.registerCommand({
      name,
      description,
      requireAuth: false,
      handler,
    });
  }
}

function formatWorkflowSelectionLabel(args: string) {
  const parsed = parseWorkflowCheckInput(args);
  if (parsed.all) return "all";
  if (parsed.id) return `id=${parsed.id}`;
  if (parsed.status) return `status=${parsed.status}`;
  if (parsed.text) return `text=${parsed.text}`;
  if (parsed.limit) return `latest:${parsed.limit}`;
  return "latest";
}

function formatWorkflowStatusCounts(tasks: MiyaWorkflowQueueEntry[]) {
  if (tasks.length === 0) return "none";
  const counts = new Map<string, number>();
  for (const task of tasks) {
    counts.set(task.status, (counts.get(task.status) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([status, count]) => `${status}=${count}`)
    .join(", ");
}

function renderWorkflowStatusResponse(
  tasks: MiyaWorkflowQueueEntry[],
  selected: ReturnType<typeof selectWorkflowTasksForCheck>,
  selectionLabel: string,
) {
  const contract = buildWorkflowContractSnapshot();
  const latest = tasks.at(-1) ?? null;
  const payload = buildWorkflowStatusPayload(latest ?? {
    status: "queued",
    priority: "P1",
    next_action: "Use workspace dispatcher/queue state as the continuation authority until concrete miya.workflow tasks are implemented.",
  });

  const lines = [
    `authority: ${contract.authority}`,
    `statuses: ${contract.statuses.join(", ")}`,
    `blockerTypes: ${contract.blockerTypes.join(", ")}`,
    `taskCount: ${tasks.length}`,
    `selection: ${selectionLabel}`,
    `selectionCount: ${selected.tasks.length}`,
    `statusCounts: ${formatWorkflowStatusCounts(tasks)}`,
  ];

  if (selected.tasks.length === 0) {
    lines.push("tasks: none");
    lines.push(`next_action: ${payload.state.next_action}`);
    return formatLines("Miya workflow status", lines);
  }

  if (selected.tasks.length === 1) {
    lines.push(...renderWorkflowTaskDetail(selected.tasks[0]));
    lines.push(`next_action: ${selected.tasks[0].next_action || payload.state.next_action}`);
    return formatLines("Miya workflow status", lines);
  }

  lines.push(...renderWorkflowTaskCollection(selected.tasks, 20));
  lines.push(`next_action: ${selected.tasks[0]?.next_action || payload.state.next_action}`);
  return formatLines("Miya workflow status", lines);
}

export function registerMiyaProbeCommand(api: any) {
  registerAliasCommand(
    api,
    ["miya-status"],
    "Show Miya plugin status, config paths, and phase foundations.",
    async (ctx: CommandContext) => {
      const pluginConfig = getPluginConfig(ctx);
      const diagnostics = await collectDiagnostics(pluginConfig);
      await updateRuntimeState({
        diagnosticsProbe: {
          updatedAt: new Date().toISOString(),
          ok: true,
          payload: {
            plugin: diagnostics.plugin,
            features: diagnostics.features,
            worker: diagnostics.worker,
            memoryLite: diagnostics.memoryLite,
            personaLite: diagnostics.personaLite,
            voice: diagnostics.voice,
            vramScheduler: diagnostics.vramScheduler,
            wizard: diagnostics.wizard,
            evidence: diagnostics.evidence,
            acceptanceChecklist: diagnostics.acceptanceChecklist,
          },
        },
      }, pluginConfig);
      return {
        text: formatLines("Miya probe: ok", [
          `plugin: ${diagnostics.plugin}`,
          `stateRoot: ${diagnostics.paths.stateRoot}`,
          `pluginRoot: ${diagnostics.paths.pluginRoot}`,
          `modelRoot: ${diagnostics.paths.modelRoot}`,
          `worker: ${diagnostics.worker.state} (${diagnostics.worker.detail})`,
          `buckets: ${diagnostics.modelBuckets.filter((bucket) => bucket.exists).map((bucket) => `${bucket.name}(${bucket.children.join(", ") || "-"})`).join("; ") || "none"}`,
          `memoryLite: ${diagnostics.memoryLite.enabled}/${diagnostics.memoryLite.provider}`,
          `personaLite: ${diagnostics.personaLite.enabled}/${diagnostics.personaLite.injectionMode}`,
          `voiceLite: ${diagnostics.voice.enabled}`,
          `vramScheduler: ${diagnostics.vramScheduler.enabled}/${diagnostics.vramScheduler.strategy}`,
          `wizard: ${diagnostics.wizard.enabled}/${diagnostics.wizard.currentState}`,
        ]),
      };
    },
  );
}

export function registerMiyaWorkerHealthCommand(api: any) {
  registerAliasCommand(
    api,
    ["miya-health", "miya-worker-health"],
    "Safely probe the optional Miya desktop worker health target.",
    async (ctx: CommandContext) => {
      const pluginConfig = getPluginConfig(ctx);
      const diagnostics = await collectDiagnostics(pluginConfig);
      await updateRuntimeState({
        workerHealthProbe: {
          updatedAt: new Date().toISOString(),
          ok: diagnostics.worker.ok,
          payload: {
            worker: diagnostics.worker,
            evidence: diagnostics.evidence[0],
          },
        },
      }, pluginConfig);
      return {
        text: formatLines("Miya worker health", [
          `state: ${diagnostics.worker.state}`,
          `target: ${diagnostics.worker.target}`,
          `detail: ${diagnostics.worker.detail}`,
          `observedAt: ${diagnostics.worker.observedAt}`,
          `evidence: ${JSON.stringify(diagnostics.evidence[0])}`,
        ]),
      };
    },
  );
}

export function registerMiyaWorkflowStatusCommand(api: any) {
  registerAliasCommand(
    api,
    ["miya-workflow-status", "miya-workflow-check"],
    "Show Miya workflow contract/status snapshot aligned with the workspace dispatcher contract.",
    async (ctx: CommandContext) => {
      const tasks = await listWorkflowTasks(getPluginConfig(ctx));
      const args = getCommandArgs(ctx);
      const selection = selectWorkflowTasksForCheck(tasks, parseWorkflowCheckInput(args));
      return {
        text: renderWorkflowStatusResponse(tasks, selection, formatWorkflowSelectionLabel(args)),
      };
    },
  );

  registerAliasCommand(
    api,
    ["miya-workflow-start"],
    "Create a queue-backed Miya workflow task with business fields via JSON or key:value arguments.",
    async (ctx: CommandContext) => {
      try {
        const args = getCommandArgs(ctx);
        const input = args ? parseWorkflowStartInput(args) : buildDefaultWorkflowStartInput();
        const pluginConfig = getPluginConfig(ctx);
        const created = await createWorkflowTaskFromInput(input, pluginConfig);
        const createdTask = await findWorkflowTaskById(created.id, pluginConfig);
        return {
          text: formatLines("Miya workflow start", [
            ...renderWorkflowTaskDetail(createdTask ?? { id: created.id, title: created.title, ...created.state }),
          ]),
        };
      } catch (error) {
        return {
          text: formatLines("Miya workflow start", [
            `error: ${error instanceof Error ? error.message : String(error)}`,
            "expected_input: JSON object or key:value lines such as `title: Fix runtime` and `acceptance: item1 | item2`.",
          ]),
        };
      }
    },
  );

  registerAliasCommand(
    api,
    ["miya-workflow-stop"],
    "Stop or block a Miya workflow task with explicit shared queue semantics.",
    async (ctx: CommandContext) => {
      const args = getCommandArgs(ctx);
      const pluginConfig = getPluginConfig(ctx);
      const tasks = await listWorkflowTasks(pluginConfig);
      const input = parseWorkflowStopInput(args);
      const target = resolveWorkflowStopTarget(tasks, input);

      if (!target) {
        return {
          text: formatLines("Miya workflow stop", [
            input.id
              ? `No Miya workflow task found for id=${input.id}.`
              : "No Miya workflow task found.",
            "Expected contract: map controlled stop requests to shared queue semantics such as cancelled or blocked-user-input.",
          ]),
        };
      }

      const patch = buildWorkflowStopPatch(input);
      const updated = await updateWorkflowTaskStatus(target.id, patch, pluginConfig);
      if (!updated) {
        return {
          text: formatLines("Miya workflow stop", [
            `Failed to update task ${target.id}.`,
          ]),
        };
      }
      return {
        text: formatLines("Miya workflow stop", [
          ...renderWorkflowTaskDetail({ ...target, ...updated }),
        ]),
      };
    },
  );
}

function resolveWorkerLaunch(config?: MiyaPluginConfig) {
  const worker = resolveDesktopWorkerConfig(config);
  const paths = resolveMiyaPaths(config);
  return {
    transport: worker.transport,
    endpoint: worker.endpoint,
    cwd: paths.pluginRoot,
    workerPath: path.join(paths.pluginRoot, "worker", "desktop_worker.py"),
    pythonCommand: worker.probe.command?.trim() || "python",
    timeoutMs: Math.max(worker.timeoutMs, 3000),
  };
}

async function runDesktopWorkerHttp(command: string, args: string[] = [], config?: MiyaPluginConfig) {
  const launch = resolveWorkerLaunch(config);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), launch.timeoutMs);
  const argMap: Record<string, unknown> = {};

  if (command === "capture") {
    argMap.maxEdge = Number(args[0] ?? 1280);
    argMap.jpegQuality = Number(args[1] ?? 60);
  } else if (command === "inspect_ui") {
    argMap.maxItems = Number(args[0] ?? 120);
  } else if (command === "click") {
    argMap.x = Number(args[0] ?? 0);
    argMap.y = Number(args[1] ?? 0);
    argMap.dryRun = String(args[2] ?? "false").toLowerCase() === "true";
  }

  try {
    const response = await fetch(new URL(`/${command}`, launch.endpoint).toString(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(argMap),
      signal: controller.signal,
    });
    const raw = await response.text();
    return raw.trim() || JSON.stringify({ status: response.ok ? "ok" : "error", error: `empty HTTP response (${response.status})` });
  } catch (error) {
    return JSON.stringify({ status: "error", error: error instanceof Error ? error.message : String(error) });
  } finally {
    clearTimeout(timer);
  }
}

async function runDesktopWorkerCommand(command: string, args: string[] = [], config?: MiyaPluginConfig) {
  const launch = resolveWorkerLaunch(config);
  if (launch.transport === "http") {
    return runDesktopWorkerHttp(command, args, config);
  }
  return await new Promise<string>((resolve) => {
    const child = spawn(launch.pythonCommand, [launch.workerPath, command, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
      cwd: launch.cwd,
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      resolve(JSON.stringify({ status: "error", error: `desktop worker timed out after ${launch.timeoutMs}ms (${command})` }));
    }, launch.timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve(JSON.stringify({ status: "error", error: error instanceof Error ? error.message : String(error) }));
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve(code === 0 ? stdout.trim() : JSON.stringify({ status: "error", error: stderr.trim() || `exit=${code}` }));
    });
  });
}

async function runDesktopWorkerJson(command: string, args: string[] = [], config?: MiyaPluginConfig) {
  const raw = await runDesktopWorkerCommand(command, args, config);
  try {
    return JSON.parse(raw) as Record<string, any>;
  } catch (error) {
    return {
      status: "error",
      error: `invalid worker json for ${command}: ${error instanceof Error ? error.message : String(error)}`,
      raw,
    };
  }
}

function buildAwakeStepFailure(step: string, payload: Record<string, any>, completed: string[]) {
  return {
    status: "error",
    failedStep: step,
    completed,
    error: typeof payload?.error === "string" ? payload.error : `step ${step} failed`,
    payload,
  };
}

async function persistAwakeProbe(
  config: MiyaPluginConfig | undefined,
  payload: {
    ok: boolean;
    completed: string[];
    failedStep?: string;
    error?: string;
    result: Record<string, any>;
  },
) {
  await updateRuntimeState({
    awakeProbe: {
      updatedAt: new Date().toISOString(),
      ok: payload.ok,
      completed: payload.completed,
      failedStep: payload.failedStep,
      error: payload.error,
      payload: payload.result,
    },
  }, config);
}

function resolveInspectClickTarget(inspect: Record<string, any>) {
  const firstItem = Array.isArray(inspect?.items) && inspect.items.length > 0 ? inspect.items[0] : null;
  const rect = firstItem?.rect ?? null;
  if (!rect) {
    return { x: 100, y: 100, source: "fallback" };
  }

  return {
    x: Math.round(((rect.left ?? 0) + (rect.right ?? 0)) / 2),
    y: Math.round(((rect.top ?? 0) + (rect.bottom ?? 0)) / 2),
    source: "inspect-first-item",
    item: {
      name: firstItem?.name ?? "",
      controlType: firstItem?.controlType ?? "",
      rect,
    },
  };
}

export function registerMiyaPingCommand(api: any) {
  api.registerCommand({
    name: "miya-runtime-ping",
    description: "Force-run Miya ping worker and return raw JSON.",
    requireAuth: false,
    handler: async (ctx: CommandContext) => ({ text: await runDesktopWorkerCommand("ping", [], getPluginConfig(ctx)) }),
  });
}

export function registerMiyaAwakeCommand(api: any) {
  api.registerCommand({
    name: "miya-runtime-awake",
    description: "Run Ping -> Capture -> Inspect -> Click(dry-run) acceptance chain and fail fast with the original step error if any step breaks.",
    requireAuth: false,
    handler: async (ctx: CommandContext) => {
      const pluginConfig = getPluginConfig(ctx);
      const completed: string[] = [];

      const ping = await runDesktopWorkerJson("ping", [], pluginConfig);
      if (ping?.status !== "pong" && ping?.status !== "ok") {
        const failure = buildAwakeStepFailure("ping", ping, completed);
        await persistAwakeProbe(pluginConfig, {
          ok: false,
          completed,
          failedStep: failure.failedStep,
          error: failure.error,
          result: failure,
        });
        return { text: JSON.stringify(failure, null, 2) };
      }
      completed.push("ping");

      const capture = await runDesktopWorkerJson("capture", ["960", "55"], pluginConfig);
      if (capture?.status !== "ok") {
        const failure = buildAwakeStepFailure("capture", capture, completed);
        await persistAwakeProbe(pluginConfig, {
          ok: false,
          completed,
          failedStep: failure.failedStep,
          error: failure.error,
          result: failure,
        });
        return { text: JSON.stringify(failure, null, 2) };
      }
      completed.push("capture");

      const inspect = await runDesktopWorkerJson("inspect_ui", ["50"], pluginConfig);
      if (inspect?.status !== "ok") {
        const failure = buildAwakeStepFailure("inspect_ui", inspect, completed);
        await persistAwakeProbe(pluginConfig, {
          ok: false,
          completed,
          failedStep: failure.failedStep,
          error: failure.error,
          result: failure,
        });
        return { text: JSON.stringify(failure, null, 2) };
      }
      completed.push("inspect_ui");

      const clickTarget = resolveInspectClickTarget(inspect);
      const click = await runDesktopWorkerJson("click", [String(clickTarget.x), String(clickTarget.y), "true"], pluginConfig);
      if (click?.status !== "ok") {
        const failure = buildAwakeStepFailure("click", { ...click, clickTarget }, completed);
        await persistAwakeProbe(pluginConfig, {
          ok: false,
          completed,
          failedStep: failure.failedStep,
          error: failure.error,
          result: failure,
        });
        return { text: JSON.stringify(failure, null, 2) };
      }
      completed.push("click");

      const success = { status: "ok", completed, ping, capture, inspect, clickTarget, click };
      await persistAwakeProbe(pluginConfig, {
        ok: true,
        completed,
        result: success,
      });

      return {
        text: JSON.stringify(success, null, 2),
      };
    },
  });
}

export function registerMiyaCapabilitiesCommand(api: any) {
  api.registerCommand({
    name: "miya-capabilities",
    description: "List current Miya runtime command/tool/foundation capabilities.",
    requireAuth: false,
    handler: async (ctx: CommandContext) => {
      const features = resolveFeatureFlags(getPluginConfig(ctx));
      return {
        text: JSON.stringify({
          commands: {
            probe: features.probeCommand,
            workerHealth: features.workerHealthCommand,
            capabilities: features.capabilitiesCommand,
            workflowStatus: true,
            workflowStart: true,
            workflowStop: true,
            ping: true,
            awake: true,
          },
          tools: {
            ping: true,
            capture: true,
            inspectUi: true,
            click: true,
          },
          hooks: {
            sessionStartDispatcher: true,
            beforeAgentStartDispatcher: true,
            agentEndDispatcher: true,
            subagentEndedDispatcher: true,
          },
        }, null, 2),
      };
    },
  });
}
