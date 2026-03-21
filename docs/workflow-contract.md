# Miya Workflow Contract (Plugin-Local Reference)

## Purpose

Keep the Miya plugin aligned with the shared OpenClaw continuous-work substrate.

This plugin-local reference mirrors the workspace contract so plugin implementation can consume the same task protocol instead of drifting into a second workflow state model.

Canonical upstream references:
- `F:\openclaw\workspace\TASK_QUEUE.md`
- `F:\openclaw\workspace\scripts\continuous-dispatcher.mjs`
- `F:\openclaw\workspace\docs\miya-plugin-capability-contract.md`

---

## Shared task fields
- `status`
- `priority`
- `depends_on`
- `blocker_type`
- `acceptance`
- `verify`
- `artifacts`
- `last_update`
- `notes`
- `next_action`

## Shared statuses
- `queued`
- `running`
- `verifying`
- `retry`
- `blocked-runtime-policy`
- `blocked-user-input`
- `blocked-external`
- `done`
- `cancelled`

## Shared blocker types
- `runtime-policy`
- `user-input`
- `external`

---

## Plugin implementation rule

When adding or evolving these plugin capability families:
- `miya.status.get`
- `miya.workflow.start`
- `miya.workflow.check`
- `miya.workflow.stop`
- `miya.memory.search`
- `miya.memory.confirm`
- `miya.desktop.describe`
- `miya.desktop.act`
- `miya.voice.play`
- `miya.voice.stop`

Do **not** introduce:
- a second status vocabulary
- a second blocker taxonomy
- a second queue schema
- a second workflow truth source by default

Instead:
- map workflow state to the shared queue contract
- expose `next_action` whenever workflow state is reported
- preserve blocker semantics with `blocker_type`
- keep evidence and notes attachable to the same shared contract

---

## Near-term coding guidance

When plugin workflow/status surfaces are implemented:
1. read/emit the shared fields above
2. keep `miya.workflow.check` compatible with dispatcher output concepts
3. avoid daemon-first assumptions
4. treat the workspace dispatcher/queue pair as the canonical continuation substrate
5. prefer plugin-local helpers in `src/workflow-contract.ts` and `src/workflow-state.ts` instead of redefining fields/statuses ad hoc
