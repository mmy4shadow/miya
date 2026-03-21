import type { MiyaPluginConfig } from "./config.ts";
import {
  buildWorkflowStopPatch,
  createWorkflowTaskFromInput,
  parseWorkflowCheckInput,
  parseWorkflowStopInput,
  resolveWorkflowStopTarget,
  selectWorkflowTasksForCheck,
} from "./workflow-commands.ts";
import { findWorkflowTaskById, listWorkflowTasks, updateWorkflowTaskStatus } from "./workflow-queue.ts";

function getPluginConfig(api: any): MiyaPluginConfig {
  return (api?.pluginConfig ?? api?.config?.plugins?.entries?.miya?.config ?? {}) as MiyaPluginConfig;
}

export async function startWorkflowTask(input: Record<string, unknown>, config?: MiyaPluginConfig) {
  const created = await createWorkflowTaskFromInput({
    title: typeof input.title === "string" ? input.title : undefined,
    status: typeof input.status === "string" ? input.status as any : undefined,
    priority: typeof input.priority === "string" ? input.priority : undefined,
    depends_on: Array.isArray(input.depends_on) ? input.depends_on.map((value) => String(value)) : undefined,
    blocker_type: typeof input.blocker_type === "string" ? input.blocker_type as any : undefined,
    next_action: typeof input.next_action === "string" ? input.next_action : undefined,
    acceptance: Array.isArray(input.acceptance) ? input.acceptance.map((value) => String(value)) : undefined,
    verify: Array.isArray(input.verify) ? input.verify.map((value) => String(value)) : undefined,
    artifacts: Array.isArray(input.artifacts) ? input.artifacts.map((value) => String(value)) : undefined,
    notes: Array.isArray(input.notes) ? input.notes.map((value) => String(value)) : undefined,
  }, config);
  const task = await findWorkflowTaskById(created.id, config);
  return {
    status: "ok",
    task: task ?? { id: created.id, title: created.title, ...created.state },
  };
}

export async function checkWorkflowTasks(input: Record<string, unknown>, config?: MiyaPluginConfig) {
  const tasks = await listWorkflowTasks(config);
  const selection = selectWorkflowTasksForCheck(tasks, parseWorkflowCheckInput(JSON.stringify(input)));
  return {
    status: "ok",
    summary: selection.summary,
    selection,
  };
}

export async function stopWorkflowTask(input: Record<string, unknown>, config?: MiyaPluginConfig) {
  const tasks = await listWorkflowTasks(config);
  const stopInput = parseWorkflowStopInput(JSON.stringify(input));
  const target = resolveWorkflowStopTarget(tasks, stopInput);
  if (!target) {
    return {
      status: "error",
      code: "workflow_task_not_found",
      error: stopInput.id ? `workflow task not found: ${stopInput.id}` : "workflow task not found",
    };
  }

  const patch = buildWorkflowStopPatch(stopInput);
  const updated = await updateWorkflowTaskStatus(target.id, patch, config);
  if (!updated) {
    return {
      status: "error",
      code: "workflow_update_failed",
      error: `failed to update task ${target.id}`,
    };
  }

  return {
    status: "ok",
    task: {
      ...target,
      ...updated,
    },
  };
}

export function registerWorkflowTools(api: any) {
  const config = getPluginConfig(api);

  api.registerTool({
    name: "miya_workflow_start",
    description: "Create a queue-backed Miya workflow task.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        title: { type: "string" },
        status: { type: "string" },
        priority: { type: "string" },
        depends_on: { type: "array", items: { type: "string" } },
        blocker_type: { type: "string" },
        next_action: { type: "string" },
        acceptance: { type: "array", items: { type: "string" } },
        verify: { type: "array", items: { type: "string" } },
        artifacts: { type: "array", items: { type: "string" } },
        notes: { type: "array", items: { type: "string" } },
      },
    },
    async execute(_id: string, params: Record<string, unknown>) {
      const payload = await startWorkflowTask(params, config);
      return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
        structuredContent: payload,
      };
    },
  });

  api.registerTool({
    name: "miya_workflow_check",
    description: "Read queue-backed Miya workflow task state.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        id: { type: "string" },
        status: { type: "string" },
        text: { type: "string" },
        limit: { type: "integer", minimum: 1 },
        all: { type: "boolean" },
      },
    },
    async execute(_id: string, params: Record<string, unknown>) {
      const payload = await checkWorkflowTasks(params, config);
      return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
        structuredContent: payload,
      };
    },
  });

  api.registerTool({
    name: "miya_workflow_stop",
    description: "Stop or block a queue-backed Miya workflow task.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        id: { type: "string" },
        status: { type: "string" },
        reason: { type: "string" },
        next_action: { type: "string" },
        note: { type: "string" },
      },
    },
    async execute(_id: string, params: Record<string, unknown>) {
      const payload = await stopWorkflowTask(params, config);
      return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
        structuredContent: payload,
      };
    },
  });
}
