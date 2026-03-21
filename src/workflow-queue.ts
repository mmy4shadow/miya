import fs from "node:fs/promises";
import path from "node:path";
import { normalizeWorkflowState, type MiyaWorkflowState } from "./workflow-state.ts";
import type { MiyaPluginConfig } from "./config.ts";
import { resolveMiyaPaths } from "./paths.ts";

const LIST_FIELDS = ["acceptance", "verify", "artifacts", "notes"] as const;
const APPENDABLE_LIST_FIELDS = ["depends_on", ...LIST_FIELDS] as const;
const PLACEHOLDER_PATTERNS = [
  /^replace scaffold\b/i,
  /^define acceptance\b/i,
  /^define verification\b/i,
  /^record relevant output artifacts\b/i,
  /^record artifacts\b/i,
  /^created by miya-workflow-start\b/i,
] as const;

export type MiyaWorkflowQueueEntry = MiyaWorkflowState & {
  id: string;
  title: string;
  startLine?: number;
  endLine?: number;
};

export type MiyaWorkflowTaskPatch = Partial<MiyaWorkflowState> & {
  append_depends_on?: string[];
  append_acceptance?: string[];
  append_verify?: string[];
  append_artifacts?: string[];
  append_notes?: string[];
};

function getWorkspaceRoot(config?: MiyaPluginConfig) {
  return path.join(resolveMiyaPaths(config).stateRoot, "workspace");
}

function getTaskQueuePath(config?: MiyaPluginConfig) {
  return path.join(getWorkspaceRoot(config), "TASK_QUEUE.md");
}

export async function readTaskQueueText(config?: MiyaPluginConfig) {
  return await fs.readFile(getTaskQueuePath(config), "utf8");
}

function parseListValue(raw: string) {
  const t = raw.trim();
  if (!t.startsWith("[") || !t.endsWith("]")) return [];
  const inner = t.slice(1, -1).trim();
  if (!inner) return [];
  return inner.split(",").map((s) => s.trim()).filter(Boolean);
}

export function parseTaskQueue(markdown: string): MiyaWorkflowQueueEntry[] {
  const lines = markdown.split(/\r?\n/);
  const tasks: MiyaWorkflowQueueEntry[] = [];
  let current: MiyaWorkflowQueueEntry | null = null;
  let section: "acceptance" | "verify" | "artifacts" | "notes" | null = null;
  const listSections = new Set(LIST_FIELDS);

  function pushCurrent(endLine: number) {
    if (!current) return;
    const normalized = normalizeWorkflowState(current);
    tasks.push({ ...current, ...normalized, startLine: current.startLine, endLine });
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const heading = line.match(/^##\s+([^\s]+)\s+-\s+(.+)$/);
    if (heading) {
      pushCurrent(i - 1);
      current = { id: heading[1], title: heading[2].trim(), status: "queued", startLine: i } as MiyaWorkflowQueueEntry;
      section = null;
      continue;
    }
    if (!current) continue;

    const field = line.match(/^-\s+([a-z_]+):\s*(.*)$/);
    if (field) {
      const key = field[1];
      const value = field[2] ?? "";
      if (listSections.has(key)) {
        section = key as typeof section;
        (current as any)[section] = [];
        continue;
      }
      section = null;
      if (key === "depends_on") current.depends_on = parseListValue(value);
      else (current as any)[key] = value.trim();
      continue;
    }

    const bullet = line.match(/^\s*-\s+(.*)$/);
    if (bullet && section) {
      ((current as any)[section] ||= []).push(bullet[1].trim());
    }
  }

  pushCurrent(lines.length - 1);
  return tasks;
}

export async function listWorkflowTasks(config?: MiyaPluginConfig) {
  const markdown = await readTaskQueueText(config);
  return parseTaskQueue(markdown).filter((task) => task.id.startsWith("TMIYA-"));
}

export async function findWorkflowTaskById(id: string, config?: MiyaPluginConfig) {
  const markdown = await readTaskQueueText(config);
  return parseTaskQueue(markdown).find((task) => task.id === id) ?? null;
}

export async function appendWorkflowTask(task: { id: string; title: string } & Partial<MiyaWorkflowState>, config?: MiyaPluginConfig) {
  const state = normalizeWorkflowState(task);
  const block = buildTaskBlock({
    id: task.id,
    title: task.title,
    ...state,
    last_update: state.last_update || new Date().toISOString(),
  }).join("\n");

  const taskQueuePath = getTaskQueuePath(config);
  await fs.mkdir(path.dirname(taskQueuePath), { recursive: true });
  let current = "";
  try {
    current = await readTaskQueueText(config);
  } catch {
    current = "# Task Queue\n";
  }
  await fs.writeFile(taskQueuePath, `${current.trimEnd()}\n\n${block}`, "utf8");
  return { id: task.id, title: task.title, state };
}

function normalizeList(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    normalized.push(text);
  }
  return normalized;
}

function isPlaceholderText(value: string) {
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(value.trim()));
}

function hasConcreteListEvidence(values: string[] | undefined, opts?: { requireVerifiedPrefix?: boolean }) {
  const normalized = normalizeList(values ?? []);
  if (normalized.length === 0) return false;
  const concrete = normalized.filter((value) => !isPlaceholderText(value));
  if (concrete.length === 0) return false;
  if (opts?.requireVerifiedPrefix) {
    return concrete.some((value) => /^(verified|acceptance|evidence):/i.test(value));
  }
  return concrete.length > 0;
}

function validateDoneTransition(task: MiyaWorkflowQueueEntry, nextState: MiyaWorkflowState) {
  const errors: string[] = [];
  if (!hasConcreteListEvidence(nextState.acceptance)) {
    errors.push(`task ${task.id} cannot move to done without concrete acceptance criteria`);
  }
  if (!hasConcreteListEvidence(nextState.verify)) {
    errors.push(`task ${task.id} cannot move to done without concrete verification steps`);
  }
  if (!hasConcreteListEvidence(nextState.artifacts)) {
    errors.push(`task ${task.id} cannot move to done without concrete artifacts`);
  }
  if (!hasConcreteListEvidence(nextState.notes, { requireVerifiedPrefix: true })) {
    errors.push(`task ${task.id} cannot move to done without verification evidence in notes`);
  }
  if (errors.length > 0) {
    throw new Error(errors.join("; "));
  }
}

function mergeWorkflowTaskState(task: MiyaWorkflowQueueEntry, patch: MiyaWorkflowTaskPatch) {
  const nextState: Partial<MiyaWorkflowState> = {
    ...task,
    ...patch,
    last_update: new Date().toISOString(),
  };

  for (const field of APPENDABLE_LIST_FIELDS) {
    const replaceValue = field in patch ? (patch as Record<string, unknown>)[field] : undefined;
    const appendKey = `append_${field}` as keyof MiyaWorkflowTaskPatch;
    const appendValue = patch[appendKey];
    const baseValue = field === "depends_on"
      ? normalizeList(task.depends_on ?? [])
      : normalizeList((task as Record<string, unknown>)[field] as string[] | undefined);

    const replaced = replaceValue === undefined ? baseValue : normalizeList(replaceValue);
    const appended = normalizeList(appendValue);
    const merged = normalizeList([...replaced, ...appended]);
    (nextState as Record<string, unknown>)[field] = merged;
  }

  if (patch.status === "done" && patch.blocker_type === undefined) {
    nextState.blocker_type = "";
  }

  const normalized = normalizeWorkflowState(nextState);
  if (normalized.status === "done") {
    validateDoneTransition(task, normalized);
  }
  return normalized;
}

function buildTaskBlock(task: { id: string; title: string } & Partial<MiyaWorkflowState>) {
  const state = normalizeWorkflowState(task);
  return [
    `## ${task.id} - ${task.title}`,
    `- status: ${state.status}`,
    `- priority: ${state.priority}`,
    `- depends_on: [${(state.depends_on ?? []).join(", ")}]`,
    `- blocker_type: ${state.blocker_type ?? ""}`,
    `- acceptance:`,
    ...(state.acceptance ?? []).map((value) => `  - ${value}`),
    `- verify:`,
    ...(state.verify ?? []).map((value) => `  - ${value}`),
    `- artifacts:`,
    ...(state.artifacts ?? []).map((value) => `  - ${value}`),
    `- last_update: ${state.last_update ?? ""}`,
    `- notes:`,
    ...(state.notes ?? []).map((value) => `  - ${value}`),
    `- next_action: ${state.next_action ?? ""}`,
    "",
  ];
}

export function applyWorkflowTaskPatchToMarkdown(markdown: string, id: string, patch: MiyaWorkflowTaskPatch) {
  const lines = markdown.split(/\r?\n/);
  const tasks = parseTaskQueue(markdown);
  const task = tasks.find((entry) => entry.id === id);
  if (!task || task.startLine == null || task.endLine == null) {
    throw new Error(`workflow task not found: ${id}`);
  }

  const mergedState = mergeWorkflowTaskState(task, patch);
  const mergedTask: MiyaWorkflowQueueEntry = {
    ...task,
    ...mergedState,
  };
  const replacement = buildTaskBlock({
    id: task.id,
    title: task.title,
    ...mergedState,
  });
  lines.splice(task.startLine, task.endLine - task.startLine + 1, ...replacement);

  return {
    markdown: lines.join("\n"),
    task: mergedTask,
  };
}

export async function updateWorkflowTaskStatus(id: string, patch: MiyaWorkflowTaskPatch, config?: MiyaPluginConfig) {
  const markdown = await readTaskQueueText(config);
  try {
    const result = applyWorkflowTaskPatchToMarkdown(markdown, id, patch);
    await fs.writeFile(getTaskQueuePath(config), result.markdown, "utf8");
    return normalizeWorkflowState(result.task);
  } catch (error) {
    if (error instanceof Error && /workflow task not found:/i.test(error.message)) {
      return null;
    }
    throw error;
  }
}
