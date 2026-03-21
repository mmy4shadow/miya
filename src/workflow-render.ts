import type { MiyaWorkflowQueueEntry } from "./workflow-queue.ts";

export function renderWorkflowTaskSummary(task: MiyaWorkflowQueueEntry | null) {
  if (!task) {
    return [
      "task: none",
      "status: queued",
      "next_action: No Miya workflow task exists yet.",
    ];
  }

  return [
    `task: ${task.id}`,
    `title: ${task.title}`,
    `status: ${task.status}`,
    `priority: ${task.priority || "P1"}`,
    `blocker_type: ${task.blocker_type || ""}`,
    `depends_on: ${(task.depends_on || []).join(", ") || "[]"}`,
    `next_action: ${task.next_action || ""}`,
  ];
}

export function renderWorkflowTaskDetail(task: MiyaWorkflowQueueEntry | null) {
  if (!task) return ["task: none"];
  return [
    ...renderWorkflowTaskSummary(task),
    `acceptance: ${(task.acceptance || []).join(" | ")}`,
    `verify: ${(task.verify || []).join(" | ")}`,
    `artifacts: ${(task.artifacts || []).join(" | ")}`,
    `notes: ${(task.notes || []).join(" | ")}`,
    `last_update: ${task.last_update || ""}`,
  ];
}

export function renderWorkflowTaskCollection(tasks: MiyaWorkflowQueueEntry[], limit = 10) {
  if (tasks.length === 0) {
    return ["tasks: none"];
  }

  return tasks.slice(0, Math.max(1, limit)).flatMap((task, index) => [
    `task[${index}]: ${task.id}`,
    `  title: ${task.title}`,
    `  status: ${task.status}`,
    `  priority: ${task.priority || "P1"}`,
    `  blocker_type: ${task.blocker_type || ""}`,
    `  next_action: ${task.next_action || ""}`,
  ]);
}
