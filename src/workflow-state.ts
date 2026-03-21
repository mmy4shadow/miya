import {
  MIYA_WORKFLOW_BLOCKER_TYPES,
  MIYA_WORKFLOW_SHARED_FIELDS,
  MIYA_WORKFLOW_SHARED_STATUSES,
  type MiyaWorkflowBlockerType,
  type MiyaWorkflowSharedStatus,
} from "./workflow-contract.ts";

export type MiyaWorkflowState = {
  status: MiyaWorkflowSharedStatus;
  priority?: string;
  depends_on?: string[];
  blocker_type?: MiyaWorkflowBlockerType | "";
  acceptance?: string[];
  verify?: string[];
  artifacts?: string[];
  last_update?: string;
  notes?: string[];
  next_action?: string;
};

export function normalizeWorkflowState(input: Partial<MiyaWorkflowState>) {
  return {
    status: MIYA_WORKFLOW_SHARED_STATUSES.includes((input.status ?? "queued") as MiyaWorkflowSharedStatus)
      ? (input.status ?? "queued") as MiyaWorkflowSharedStatus
      : "queued",
    priority: input.priority ?? "P1",
    depends_on: Array.isArray(input.depends_on) ? input.depends_on : [],
    blocker_type: MIYA_WORKFLOW_BLOCKER_TYPES.includes((input.blocker_type ?? "") as MiyaWorkflowBlockerType)
      ? (input.blocker_type ?? "") as MiyaWorkflowBlockerType
      : "",
    acceptance: Array.isArray(input.acceptance) ? input.acceptance : [],
    verify: Array.isArray(input.verify) ? input.verify : [],
    artifacts: Array.isArray(input.artifacts) ? input.artifacts : [],
    last_update: input.last_update ?? "",
    notes: Array.isArray(input.notes) ? input.notes : [],
    next_action: input.next_action ?? "",
  };
}

export function buildWorkflowStatusPayload(input: Partial<MiyaWorkflowState>) {
  const state = normalizeWorkflowState(input);
  return {
    authority: "workspace-dispatcher",
    fields: [...MIYA_WORKFLOW_SHARED_FIELDS],
    state,
  };
}
