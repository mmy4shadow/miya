import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const commandsModule = await import(pathToFileURL(path.resolve("F:/openclaw/miya/src/workflow-commands.ts")).href);

test("selectWorkflowTasksForCheck filters by status and applies a latest-first limit", () => {
  assert.equal(typeof commandsModule.selectWorkflowTasksForCheck, "function");

  const tasks = [
    { id: "TMIYA-1", title: "old retry", status: "retry", priority: "P2", last_update: "2026-03-20T20:00:00+08:00", next_action: "retry old" },
    { id: "TMIYA-2", title: "latest running", status: "running", priority: "P1", last_update: "2026-03-20T21:00:00+08:00", next_action: "keep running" },
    { id: "TMIYA-3", title: "latest retry", status: "retry", priority: "P1", last_update: "2026-03-20T22:00:00+08:00", next_action: "retry latest" },
  ];

  const result = commandsModule.selectWorkflowTasksForCheck(tasks, {
    status: "retry",
    limit: 1,
  });

  assert.equal(result.tasks.length, 1);
  assert.equal(result.tasks[0].id, "TMIYA-3");
  assert.equal(result.summary.byStatus.retry, 2);
});

test("parseWorkflowStopInput supports precise id/status/reason fields", () => {
  assert.equal(typeof commandsModule.parseWorkflowStopInput, "function");

  const parsed = commandsModule.parseWorkflowStopInput([
    "id: TMIYA-77",
    "status: blocked-user-input",
    "reason: Need the user to confirm the launcher path.",
    "next_action: Wait for user confirmation before resuming.",
  ].join("\n"));

  assert.equal(parsed.id, "TMIYA-77");
  assert.equal(parsed.status, "blocked-user-input");
  assert.equal(parsed.reason, "Need the user to confirm the launcher path.");
  assert.equal(parsed.next_action, "Wait for user confirmation before resuming.");
});

test("buildWorkflowStopPatch maps blocked-user-input into shared queue semantics", () => {
  assert.equal(typeof commandsModule.buildWorkflowStopPatch, "function");

  const patch = commandsModule.buildWorkflowStopPatch({
    status: "blocked-user-input",
    reason: "Need the user to confirm the launcher path.",
    next_action: "Wait for user confirmation before resuming.",
  });

  assert.equal(patch.status, "blocked-user-input");
  assert.equal(patch.blocker_type, "user-input");
  assert.equal(patch.next_action, "Wait for user confirmation before resuming.");
  assert.deepEqual(patch.append_notes, [
    "Blocked: Need the user to confirm the launcher path.",
  ]);
});

test("resolveWorkflowStopTarget prefers explicit id and otherwise picks the latest active task", () => {
  assert.equal(typeof commandsModule.resolveWorkflowStopTarget, "function");

  const tasks = [
    { id: "TMIYA-1", title: "queued", status: "queued", priority: "P2", last_update: "2026-03-20T19:00:00+08:00", next_action: "wait" },
    { id: "TMIYA-2", title: "running", status: "running", priority: "P1", last_update: "2026-03-20T20:00:00+08:00", next_action: "run" },
    { id: "TMIYA-3", title: "retry", status: "retry", priority: "P1", last_update: "2026-03-20T21:00:00+08:00", next_action: "retry" },
  ];

  const explicit = commandsModule.resolveWorkflowStopTarget(tasks, { id: "TMIYA-2" });
  const implicit = commandsModule.resolveWorkflowStopTarget(tasks, {});

  assert.equal(explicit?.id, "TMIYA-2");
  assert.equal(implicit?.id, "TMIYA-3");
});
