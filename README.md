# Miya OpenClaw Plugin Scaffold

Minimal local OpenClaw plugin scaffold for Miya, now extended with honest Phase 1-6 foundations.

This repo is still intentionally small. The goal is not to rebuild OpenClaw core, but to define Miya-owned boundaries that can grow into real closed loops once external runtimes are attached.

## Current scope

Implemented now:
- plugin manifest: `openclaw.plugin.json`
- package metadata for local plugin loading
- plugin entry under `src/`
- safe commands:
  - `/miya-probe`
  - `/miya-worker-health`
  - `/miya-capabilities`
- Phase 1 worker boundary:
  - desktop worker config (`transport: http | command`)
  - worker health probe abstraction (`http` or `command`)
  - small worker client module
  - real local desktop worker actions:
    - `activate_window`
    - `click`
    - `hotkey`
    - `type_text`
    - `press_key`
  - evidence record shape
- Phase 2 placeholders:
  - `memory-lite` config + status helper
  - `persona-lite` config + static fallback strategy
- Phase 3 placeholders:
  - voice stage config for VAD / ASR / TTS / speaker-id
  - model asset mapping to local folders
- Phase 4 placeholders:
  - declarative VRAM scheduler lanes and priorities
- Phase 5 placeholders:
  - wizard state and local training job descriptors
- Phase 6 diagnostics:
  - consolidated diagnostics collector
  - runtime evidence persisted to `state/evidence.jsonl`
  - acceptance checklist
  - validation doc
- queue-backed workflow control:
  - workflow commands for start/check/stop
  - workflow HTTP routes:
    - `GET|POST /plugins/miya/workflow/check`
    - `POST /plugins/miya/workflow/start`
    - `POST /plugins/miya/workflow/stop`
  - workflow tools:
    - `miya_workflow_start`
    - `miya_workflow_check`
    - `miya_workflow_stop`
- high-level desktop run tool:
  - `miya_desktop_run`
- local model path inventory in `docs/MODELS.md`
- roadmap in `docs/ROADMAP.md`

Not implemented yet:
- live memory-lite recall logic
- runtime persona injection beyond static/fallback docs
- real voice execution
- real image generation execution
- real VRAM arbitration/admission
- real training jobs
- Canvas integration

## Design stance

Miya uses OpenClaw core for:
- channels
- gateway
- sessions
- plugin lifecycle
- existing memory/tool primitives where available

Miya only adds thin, Miya-specific layers where that creates a real future integration point.

## Layout

```text
miya-dev/
├── docs/
│   ├── DEV-WORKFLOW.md
│   ├── MODELS.md
│   ├── PHASE1-WORKER.md
│   ├── ROADMAP.md
│   └── VALIDATION.md
├── skill/
│   └── miya-probe/
│       └── SKILL.md
├── src/
│   ├── config.ts
│   ├── diagnostics.ts
│   ├── evidence.ts
│   ├── index.ts
│   ├── memory-lite.ts
│   ├── paths.ts
│   ├── persona-lite.ts
│   ├── probe-command.ts
│   ├── voice.ts
│   ├── vram-scheduler.ts
│   ├── wizard.ts
│   └── worker-client.ts
├── model/
├── openclaw.plugin.json
├── package.json
└── README.md
```

## Commands

### `/miya-probe`
High-level snapshot of configured paths, worker state, model buckets, and phase placeholder status.

### `/miya-worker-health`
Safe health probe for the optional local worker.

- If worker is disabled: returns `disabled`
- If probe mode is `http`: calls `<endpoint><path>` with timeout
- If probe mode is `command`: executes the configured command and checks exit code
- No desktop action is performed

### `/miya-capabilities`
Shows mapped local assets, VRAM lane definitions, wizard placeholders, and Phase 6 acceptance checklist status.

## Install for local development

```bash
openclaw plugins install -l F:\openclaw\miya
```

Then enable/restart as needed:

```bash
openclaw plugins enable miya
openclaw gateway restart
```

After load, test with:

```text
/miya-probe
/miya-worker-health
/miya-capabilities
```

Before reloads, you can also validate the local scaffold from the plugin root:

```bash
npm run check
```

For the full local `Operation-Miya-Awake` acceptance chain (ping -> capture -> inspect_ui -> click dry-run), run:

```bash
npm run acceptance
```

Both `npm run acceptance` and `npm run smoke` now follow the active Miya desktop worker runtime from `F:\openclaw\openclaw.json` (or `OPENCLAW_CONFIG_PATH` / `MIYA_DESKTOP_WORKER_*` env overrides), so local validation stays aligned with the configured `http` vs `command` transport. When the click dry-run is blocked because someone is actively using the keyboard/mouse, `npm run acceptance` reports `blocked-external` with the original payload so automation can treat it as a truthful external blocker instead of a fake generic failure.

To bootstrap the project-owned local vision runtime on Windows:

```bash
npm run vision:setup
```

To bootstrap local voice/image runtime dependencies on Windows:

```bash
npm run voice:setup
npm run image:setup
```

`voice:setup` prepares the Python package stack plus a local Qwen3-TTS download target.
`image:setup` prepares the Python diffusion stack and verifies the local FLUX model trees.

That script downloads an official `llama.cpp` Windows runtime plus the missing Qwen3-VL `mmproj` file into the Miya project tree. Until those assets exist, `worker/vision_sidecar.py` truthfully reports `vision_unavailable` instead of pretending local visual reasoning is online.

## Example config sketch

```json
{
  "plugins": {
    "entries": {
      "miya": {
        "config": {
          "desktopWorker": {
            "enabled": true,
            "endpoint": "http://127.0.0.1:43111",
            "probe": {
              "mode": "http",
              "path": "/health"
            }
          },
          "vision": {
            "provider": "auto",
            "runtimeRoot": "F:\\openclaw\\miya\\runtime\\vision\\llama.cpp",
            "modelPath": "F:\\openclaw\\miya\\model\\vision\\qwen3vl_4b_instruct_q4_k_m",
            "timeoutMs": 60000
          },
          "memoryLite": {
            "enabled": true,
            "provider": "core-memory"
          },
          "personaLite": {
            "enabled": true,
            "injectionMode": "static"
          },
          "voice": {
            "tts": {
              "enabled": true,
              "provider": "external-worker"
            }
          },
          "vramScheduler": {
            "enabled": true
          },
          "wizard": {
            "enabled": true
          }
        }
      }
    }
  }
}
```

## Reality check

This repo now has better structure, not fake completeness.

What is real today:
- config schema and resolvers
- worker health probing logic
- local asset discovery
- Gateway desktop route: `/plugins/miya/desktop/run`
- Gateway workflow routes: `/plugins/miya/workflow/*`
- Gateway voice routes: `/plugins/miya/voice/*`
- Gateway image route: `/plugins/miya/image/generate`
- structured desktop actions with truthful worker execution
- queue-backed continuous-work control surfaces
- project-contained vision sidecar launcher and runtime bootstrap script
- project-contained voice/image sidecar boundaries
- diagnostics aggregation
- command surfaces for inspection
- tool surfaces for desktop run and workflow control
- tool surfaces for voice/image contracts
- local scaffold validation via `npm run check`

What still needs an external runtime or next batch:
- a live `llama-server` runtime plus local `mmproj` to make vision truly available
- a real voice executor behind `worker/voice_sidecar.py`
- a real image executor behind `worker/image_sidecar.py`
- persistence for wizard jobs
- actual memory/persona/voice behavior on top of OpenClaw runtime hooks

## Recommended next validation batch

1. Attach a tiny local worker exposing `/health`
2. Verify `/miya-worker-health` against a live loopback endpoint
3. Add one read-only worker action such as `capture` metadata only
4. Persist evidence records to a plugin-local diagnostics file
5. Decide whether memory-lite should remain core-only or use the local embedding asset via a separate runtime
