export const MIYA_WORKFLOW_SHARED_FIELDS = [
  "status",
  "priority",
  "depends_on",
  "blocker_type",
  "acceptance",
  "verify",
  "artifacts",
  "last_update",
  "notes",
  "next_action",
] as const;

export const MIYA_WORKFLOW_SHARED_STATUSES = [
  "queued",
  "running",
  "verifying",
  "retry",
  "blocked-runtime-policy",
  "blocked-user-input",
  "blocked-external",
  "done",
  "cancelled",
] as const;

export const MIYA_WORKFLOW_BLOCKER_TYPES = [
  "runtime-policy",
  "user-input",
  "external",
] as const;

export type MiyaWorkflowSharedField = typeof MIYA_WORKFLOW_SHARED_FIELDS[number];
export type MiyaWorkflowSharedStatus = typeof MIYA_WORKFLOW_SHARED_STATUSES[number];
export type MiyaWorkflowBlockerType = typeof MIYA_WORKFLOW_BLOCKER_TYPES[number];

export function buildWorkflowContractSnapshot() {
  return {
    fields: [...MIYA_WORKFLOW_SHARED_FIELDS],
    statuses: [...MIYA_WORKFLOW_SHARED_STATUSES],
    blockerTypes: [...MIYA_WORKFLOW_BLOCKER_TYPES],
    authority: "workspace-dispatcher",
  };
}
