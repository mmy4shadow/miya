import { appendWorkflowTask, type MiyaWorkflowQueueEntry } from "./workflow-queue.ts";
import type { MiyaPluginConfig } from "./config.ts";
import {
  MIYA_WORKFLOW_BLOCKER_TYPES,
  MIYA_WORKFLOW_SHARED_STATUSES,
  type MiyaWorkflowBlockerType,
  type MiyaWorkflowSharedStatus,
} from "./workflow-contract.ts";
import { normalizeWorkflowState, type MiyaWorkflowState } from "./workflow-state.ts";

export type MiyaWorkflowStartInput = {
  title?: string;
  status?: MiyaWorkflowState["status"];
  priority?: string;
  depends_on?: string[];
  blocker_type?: MiyaWorkflowState["blocker_type"] | "";
  next_action?: string;
  acceptance?: string[];
  verify?: string[];
  artifacts?: string[];
  notes?: string[];
};

export type MiyaWorkflowCheckInput = {
  id?: string;
  status?: MiyaWorkflowSharedStatus;
  text?: string;
  limit?: number;
  all?: boolean;
};

export type MiyaWorkflowCheckSelection = {
  tasks: MiyaWorkflowQueueEntry[];
  summary: {
    total: number;
    byStatus: Partial<Record<MiyaWorkflowSharedStatus, number>>;
  };
};

export type MiyaWorkflowStopInput = {
  id?: string;
  status?: MiyaWorkflowSharedStatus;
  reason?: string;
  next_action?: string;
  note?: string;
};

const ACTIVE_STOP_STATUSES = new Set<MiyaWorkflowSharedStatus>([
  "running",
  "verifying",
  "retry",
  "blocked-runtime-policy",
  "blocked-user-input",
  "blocked-external",
]);

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeStatus(value: unknown, fallback: MiyaWorkflowSharedStatus) {
  const status = normalizeText(value) as MiyaWorkflowSharedStatus;
  return MIYA_WORKFLOW_SHARED_STATUSES.includes(status) ? status : fallback;
}

function normalizeBlockerTypeForStatus(status: MiyaWorkflowSharedStatus) {
  switch (status) {
    case "blocked-runtime-policy":
      return "runtime-policy" satisfies MiyaWorkflowBlockerType;
    case "blocked-user-input":
    case "cancelled":
      return "user-input" satisfies MiyaWorkflowBlockerType;
    case "blocked-external":
      return "external" satisfies MiyaWorkflowBlockerType;
    default:
      return "";
  }
}

function parseCommandInput(raw?: string) {
  const source = normalizeText(raw);
  if (!source) return {} as Record<string, unknown>;
  if (source.startsWith("{")) {
    const parsed = JSON.parse(source);
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  }

  const lines = source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const parsed: Record<string, unknown> = {};

  for (const line of lines) {
    const match = line.match(/^([a-z_]+)\s*[:=]\s*(.*)$/i);
    if (match) {
      parsed[match[1].toLowerCase()] = match[2].trim();
      continue;
    }

    if (line.startsWith("--")) {
      const flagMatch = line.match(/^--([a-z_]+)(?:=(.*))?$/i);
      if (flagMatch) {
        parsed[flagMatch[1].toLowerCase()] = flagMatch[2] == null ? true : flagMatch[2].trim();
        continue;
      }
    }

    if (!parsed.id && /^T[A-Z0-9-]+$/i.test(line)) {
      parsed.id = line;
      continue;
    }

    parsed.text = parsed.text ? `${parsed.text} ${line}` : line;
  }

  return parsed;
}

function orderWorkflowTasksLatestFirst(tasks: MiyaWorkflowQueueEntry[]) {
  return [...tasks].sort((left, right) => {
    const leftTime = Number.isFinite(Date.parse(left.last_update || "")) ? Date.parse(left.last_update || "") : Number.NEGATIVE_INFINITY;
    const rightTime = Number.isFinite(Date.parse(right.last_update || "")) ? Date.parse(right.last_update || "") : Number.NEGATIVE_INFINITY;
    if (rightTime !== leftTime) return rightTime - leftTime;
    return right.id.localeCompare(left.id);
  });
}

export function parseWorkflowCheckInput(raw?: string): MiyaWorkflowCheckInput {
  const parsed = parseCommandInput(raw);
  const limitRaw = parsed.limit ?? parsed.max ?? parsed.count;
  const limitNumber = Number(limitRaw);
  return {
    id: normalizeText(parsed.id) || undefined,
    status: normalizeText(parsed.status) ? normalizeStatus(parsed.status, "queued") : undefined,
    text: normalizeText(parsed.text) || undefined,
    limit: Number.isFinite(limitNumber) && limitNumber > 0 ? Math.floor(limitNumber) : undefined,
    all: parsed.all === true || normalizeText(parsed.all).toLowerCase() === "true",
  };
}

export function selectWorkflowTasksForCheck(tasks: MiyaWorkflowQueueEntry[], input: MiyaWorkflowCheckInput = {}): MiyaWorkflowCheckSelection {
  const ordered = orderWorkflowTasksLatestFirst(tasks);
  const summary = {
    total: ordered.length,
    byStatus: {} as Partial<Record<MiyaWorkflowSharedStatus, number>>,
  };
  for (const task of ordered) {
    summary.byStatus[task.status] = (summary.byStatus[task.status] ?? 0) + 1;
  }

  let selected = ordered;
  if (input.id) {
    selected = selected.filter((task) => task.id === input.id);
  }
  if (input.status) {
    selected = selected.filter((task) => task.status === input.status);
  }
  if (input.text) {
    const query = input.text.toLowerCase();
    selected = selected.filter((task) => `${task.id} ${task.title} ${task.next_action || ""}`.toLowerCase().includes(query));
  }
  if (!input.all) {
    const limit = Math.max(1, input.limit ?? (input.id ? 1 : 10));
    selected = selected.slice(0, limit);
  }
  return { tasks: selected, summary };
}

export function parseWorkflowStopInput(raw?: string): MiyaWorkflowStopInput {
  const parsed = parseCommandInput(raw);
  return {
    id: normalizeText(parsed.id) || undefined,
    status: normalizeText(parsed.status) ? normalizeStatus(parsed.status, "cancelled") : undefined,
    reason: normalizeText(parsed.reason) || undefined,
    next_action: normalizeText(parsed.next_action ?? parsed.nextaction) || undefined,
    note: normalizeText(parsed.note) || undefined,
  };
}

export function buildWorkflowStopPatch(input: MiyaWorkflowStopInput = {}) {
  const status = input.status ? normalizeStatus(input.status, "cancelled") : "cancelled";
  const blockerType = normalizeBlockerTypeForStatus(status);
  const notes: string[] = [];
  if (input.reason) {
    notes.push(`${status.startsWith("blocked-") ? "Blocked" : "Stopped"}: ${input.reason}`);
  }
  if (input.note) {
    notes.push(input.note);
  }
  return {
    status,
    blocker_type: MIYA_WORKFLOW_BLOCKER_TYPES.includes(blockerType as MiyaWorkflowBlockerType)
      ? blockerType
      : "",
    next_action: input.next_action
      || (status.startsWith("blocked-")
        ? "Wait for the blocking condition to clear before resuming this workflow task."
        : "Stopped by miya-workflow-stop; wait for a new workflow start request."),
    append_notes: notes,
  } satisfies {
    status: MiyaWorkflowSharedStatus;
    blocker_type: MiyaWorkflowBlockerType | "";
    next_action: string;
    append_notes: string[];
  };
}

export function resolveWorkflowStopTarget(tasks: MiyaWorkflowQueueEntry[], input: MiyaWorkflowStopInput = {}) {
  const ordered = orderWorkflowTasksLatestFirst(tasks);
  if (input.id) {
    return ordered.find((task) => task.id === input.id) ?? null;
  }
  return ordered.find((task) => ACTIVE_STOP_STATUSES.has(task.status)) ?? ordered[0] ?? null;
}

export async function createWorkflowTaskFromInput(input: MiyaWorkflowStartInput = {}, config?: MiyaPluginConfig) {
  const id = `TMIYA-${Date.now()}`;
  const title = input.title?.trim() || "Miya workflow task";
  const normalized = normalizeWorkflowState({
    status: input.status || "queued",
    priority: input.priority || "P2",
    depends_on: input.depends_on ?? [],
    blocker_type: input.blocker_type ?? "",
    acceptance: input.acceptance?.length ? input.acceptance : ["Replace scaffold acceptance with concrete criteria."],
    verify: input.verify?.length ? input.verify : ["Replace scaffold verification with concrete checks."],
    artifacts: input.artifacts?.length ? input.artifacts : ["Record relevant output artifacts."],
    notes: input.notes?.length ? input.notes : ["Created by miya-workflow-start queue-backed command."],
    next_action: input.next_action || "Refine this created workflow task, then let the workspace dispatcher pick it up.",
  });

  return await appendWorkflowTask({
    id,
    title,
    ...normalized,
  }, config);
}
