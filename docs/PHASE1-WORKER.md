# Phase 1 — Minimal Windows Worker Boundary

## Goal

Define the thinnest possible Miya-owned desktop worker boundary that adds value beyond core OpenClaw without overbuilding.

## Design rules

- OpenClaw keeps ownership of chat, sessions, channels, gateway, cron, and plugin lifecycle.
- Miya owns only local desktop execution helpers that core does not already provide well enough.
- Phase 1 is **read-mostly + low-risk**.
- Worker is optional and disabled by default.

## Delivered plugin-side foundations

Implemented in `miya-dev`:
- config resolver for desktop worker enable/transport/endpoint/timeout
- probe abstraction with three modes:
  - `http`
  - `command`
  - `none`
- small client module: `src/worker-client.ts`
- evidence record shape: `src/evidence.ts`
- safe probe command: `/miya-worker-health`

## First capabilities only

These remain the intended first real worker actions:

1. `desktop_capture`
   - Return one current screenshot path or metadata reference.
   - No injection.

2. `desktop_inspect`
   - Inspect a target window/UIA tree summary.
   - No action.

3. `desktop_click_selector`
   - Click a UIA selector only when:
     - worker is enabled
     - human-mutex is clear
     - risk level is low

## Explicit non-goals for Phase 1

- No macro engine
- No silent background tasking
- No high-risk actions
- No keyboard text injection
- No multi-step autonomy
- No visual-language planning loop yet

## Probe modes

### HTTP mode

Default expectation:

- endpoint: `http://127.0.0.1:43111`
- path: `/health`
- method: `GET`
- expected status: `200`

This is the preferred early integration because it is easy to inspect manually.

### Command mode

Use when a worker ships as a CLI wrapper first.

Example shape:

```json
{
  "desktopWorker": {
    "enabled": true,
    "probe": {
      "mode": "command",
      "command": "python",
      "args": ["worker.py", "--health"]
    }
  }
}
```

Current implementation only checks exit code/stdout/stderr. It does not launch a long-lived daemon.

### None mode

Explicitly disables probe execution while keeping the worker config block present.

## Suggested request shapes for the future worker

### Capture

```json
{
  "action": "capture"
}
```

### Inspect

```json
{
  "action": "inspect",
  "windowTitle": "optional"
}
```

### Click selector

```json
{
  "action": "click_selector",
  "selector": {
    "name": "Send",
    "controlType": "Button"
  }
}
```

## Safety gates

Before any click action:

1. plugin config enables desktop worker
2. worker reports healthy
3. human-mutex reports no recent user input
4. action classified as low-risk
5. produce a short evidence record

## Evidence shape

Current plugin type is implemented as:

```json
{
  "time": "iso8601",
  "action": "health_probe | capabilities_probe | capture | inspect | click_selector",
  "result": "ok | blocked | failed",
  "reason": "string",
  "target": "optional",
  "selector": {
    "name": "optional",
    "controlType": "optional",
    "automationId": "optional"
  },
  "metadata": {}
}
```

## Next validation step

The next coherent batch should add exactly one real worker action after health verification:

- preferred: `capture` metadata or screenshot path only
- avoid click/injection until evidence persistence and human-mutex are real
