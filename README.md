# Miya OpenClaw Plugin Scaffold

Minimal local OpenClaw plugin scaffold for Miya, now extended with honest Phase 1-6 foundations and real local runtime paths for voice/image/vision.

This repo is still intentionally small. The goal is not to rebuild OpenClaw core, but to define Miya-owned boundaries that can grow into real closed loops on the active machine first, then grow further only where the runtime evidence says it is justified.

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
- Phase 2 runtime:
  - `memory-lite` config + status helper
  - local `memory-lite` recall from `state/memory-lite/index.json`
  - `persona-lite` config + dynamic before-prompt injection
  - single-stage prompt assembly: `runtime guard + persona + recall`
- Phase 3 runtime path:
  - voice stage config for VAD / ASR / TTS / speaker-id
  - model asset mapping to local folders
  - sidecar-backed neural VAD execution with JSON artifacts, preferring Silero on CUDA
  - sidecar-backed ASR execution through `faster-whisper`
  - sidecar-backed embedding speaker matching through local `ERes2Net`
  - sidecar-backed Qwen3-TTS synthesis through local `qwen_tts` weights
- Phase 4 scheduler foundations:
  - declarative VRAM scheduler lanes and priorities
  - persisted lane leases with dead-process pruning
  - live GPU free-memory telemetry through `nvidia-smi`
  - action-level voice admission estimates so VAD/speaker/ASR/TTS do not share one coarse VRAM budget
  - optional lower-priority lane force-eviction with persisted eviction records
  - optional external defrag hook when fragmentation risk is detected
- Phase 5 local training ledger:
  - wizard state and local training job descriptors
  - wizard HTTP/tool CRUD for staged jobs
  - wizard runner for real local dataset-prep / command execution
  - persona-dataset prep bypasses training-GPU admission when no trainer command is needed
  - external LoRA / finetune trainer binding through `wizard.trainer` or per-job overrides
  - artifact manifest capture for external trainer outputs
  - training lease release after runner exit
- Phase 6 diagnostics:
  - consolidated diagnostics collector
  - runtime evidence persisted to `state/evidence.jsonl`
  - acceptance checklist
  - validation doc
- queue-backed workflow control:
  - workflow commands for start/check/stop
  - dispatcher-backed status surface:
    - `GET|POST /plugins/miya/status/get`
    - `miya_status_get`
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

Still not implemented:
- richer neural VAD tuning and threshold management
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

### Dispatcher-backed status

Use the route/tool surface below when you need a truthful continuous-work snapshot without inventing a second scheduler:

- `GET /plugins/miya/status/get`
- `POST /plugins/miya/status/get`
- `miya_status_get`

The payload reports the workspace dispatcher's current `decision`, selected task, `nextAction`, blocked summary, the latest Miya runtime probe snapshot (`latestRuntimeProbe`), and the latest workloop/continuation wake state.

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

`voice:setup` prepares the Python package stack, restores CUDA PyTorch, warms a local `faster-whisper` cache, installs `qwen-tts`, installs the ModelScope speaker-verification dependencies used by local `ERes2Net`, installs `silero-vad`, and verifies the local Qwen3-TTS model tree under `model/audio/qwen3_tts_12hz_1_7b_customvoice`.
`image:setup` restores CUDA PyTorch, prepares the Python diffusion stack, and verifies the local FLUX model trees used by the image sidecar.

`vision:setup` now defaults to the Vulkan Windows runtime, writes a flavor marker, and refreshes stale CPU-only bundles when the requested GPU flavor is missing. Once those assets exist, `worker/vision_sidecar.py` can boot local `llama-server` with `gpuLayers=99` and return structured click decisions.

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
            "gpuLayers": 99,
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
            "enabled": true,
            "tts": {
              "enabled": true,
              "provider": "manual",
              "modelPath": "F:\\openclaw\\miya\\model\\audio\\qwen3_tts_12hz_1_7b_customvoice",
              "voiceId": "Vivian"
            },
            "speakerId": {
              "enabled": true,
              "provider": "manual",
              "modelPath": "F:\\openclaw\\miya\\model\\speaker_id\\eres2net"
            },
            "asr": {
              "enabled": true,
              "provider": "manual",
              "modelPath": "F:\\openclaw\\miya\\model\\audio\\faster_whisper_small"
            }
          },
          "image": {
            "enabled": true,
            "provider": "sidecar",
            "sidecarPath": "F:\\openclaw\\miya\\worker\\image_sidecar.py",
            "modelPreference": "balanced",
            "timeoutMs": 180000
          },
          "vramScheduler": {
            "enabled": true,
            "allowForceEvict": true,
            "fragmentationSlackMb": 512
          },
          "wizard": {
            "enabled": true,
            "trainer": {
              "lora": {
                "enabled": true,
                "command": "python",
                "args": ["train_lora.py", "--dataset", "{datasetPath}", "--output", "{outputPath}"]
              }
            }
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
- real local vision sidecar execution through `llama-server` + Qwen3-VL GGUF assets
- project-contained voice/image sidecar boundaries
- diagnostics aggregation
- command surfaces for inspection
- tool surfaces for desktop run and workflow control
- tool and HTTP surfaces for voice/image contracts
- truthful artifact-or-blocker behavior for voice/image sidecars
- real local neural VAD artifacts
- real local ASR transcript artifacts
- real local embedding speaker-match artifacts
- real local Qwen3-TTS waveform artifacts
- real local FLUX image artifacts
- staged wizard job persistence through HTTP/tools
- real local wizard runner execution for persona dataset prep
- scheduler telemetry through live GPU free-memory inspection
- route-level runtime-state and evidence persistence for voice/image, not only tool calls
- local scaffold validation via `npm run check`
- configurable VRAM force-eviction for lower-priority lanes with persisted eviction history
- configurable fragmentation diagnosis + optional defrag hook
- external LoRA / finetune trainer execution through wizard jobs
- trainer artifact manifest generation and automatic training-lease cleanup

What still needs the next batch:
- actual memory/persona/voice behavior on top of OpenClaw runtime hooks
- richer trainer adapters beyond command-template execution

## Recommended next validation batch

1. Run `python ./scripts/verify_all.py`
2. Optionally run `python ./scripts/verify_all.py --with-acceptance` on an idle desktop
3. Validate one real `POST /plugins/miya/voice/synthesize` request and confirm the WAV artifact path is created
4. Validate one real `POST /plugins/miya/image/generate` request and confirm the PNG artifact path is created
5. Validate one real desktop run against a live app and confirm evidence/run output stays stable
6. Decide whether the next milestone is richer trainer adapters, stronger memory writeback, or richer VAD controls
