import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const workflowQueueModule = await import(pathToFileURL(path.resolve("F:/openclaw/miya/src/workflow-queue.ts")).href);

const concreteTaskQueue = `# Task Queue

## TMIYA-1 - Concrete workflow task
- status: verifying
- priority: P1
- depends_on: []
- blocker_type:
- acceptance:
  - Dispatcher runs chained validation without manual approval prompts.
- verify:
  - node F:/openclaw/workspace/scripts/continuous-dispatcher-selftest.mjs
- artifacts:
  - docs/dispatcher-selftest-results.md
- last_update: 2026-03-20T21:15:00+08:00
- notes:
  - Verified: dispatcher selftest passed in the live runtime.
- next_action: Mark the task done after strict acceptance passes.
`;

const scaffoldTaskQueue = `# Task Queue

## TMIYA-2 - Scaffold workflow task
- status: verifying
- priority: P2
- depends_on: []
- blocker_type:
- acceptance:
  - Replace scaffold acceptance with concrete criteria.
- verify:
  - Replace scaffold verification with concrete checks.
- artifacts:
  - Record relevant output artifacts.
- last_update: 2026-03-20T21:15:00+08:00
- notes:
  - Created by miya-workflow-start queue-backed command.
- next_action: Replace the scaffold with a real workflow task.
`;

test("applyWorkflowTaskPatchToMarkdown rejects done transitions without real acceptance evidence", () => {
  assert.equal(typeof workflowQueueModule.applyWorkflowTaskPatchToMarkdown, "function");

  assert.throws(
    () => workflowQueueModule.applyWorkflowTaskPatchToMarkdown(scaffoldTaskQueue, "TMIYA-2", {
      status: "done",
    }),
    /verification|acceptance|artifact/i,
  );
});

test("applyWorkflowTaskPatchToMarkdown allows done transitions with concrete verification evidence", () => {
  assert.equal(typeof workflowQueueModule.applyWorkflowTaskPatchToMarkdown, "function");

  const result = workflowQueueModule.applyWorkflowTaskPatchToMarkdown(concreteTaskQueue, "TMIYA-1", {
    status: "done",
    append_notes: [
      "Verified: OpenClaw hook wake continuation triggered and strict acceptance passed.",
    ],
    append_artifacts: [
      "state/runtime-state.json",
    ],
  });

  assert.equal(result.task.status, "done");
  assert.match(result.markdown, /Verified: OpenClaw hook wake continuation triggered/);
  assert.match(result.markdown, /state\/runtime-state\.json/);
});
