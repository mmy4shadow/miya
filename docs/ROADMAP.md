# Miya Plugin Roadmap

## Scope

This repo is a minimal OpenClaw plugin scaffold for Miya.
Current work now covers honest Phase 1-6 foundations, with local ASR, local neural VAD on GPU, local `ERes2Net` embedding speaker matching on GPU, local Qwen3-TTS synthesis, local FLUX image generation, local Vulkan-backed vision sidecar execution, live GPU telemetry-backed scheduler admission, and local wizard-job execution all running on the active machine.

## Phase 0 — plugin capability probe

Goal: prove that OpenClaw can discover, link, load, and expose a tiny Miya-owned command.

Delivered:
- `openclaw.plugin.json` manifest with config schema
- package-local extension entry via `openclaw.extensions`
- `/miya-probe` command for read-only status
- centralized path defaults for plugin root, model root, and state root
- model inventory notes in `docs/MODELS.md`

## Phase 1 — minimal Windows desktop worker integration

Goal: add a very small, explicit bridge to a local Windows worker for desktop actions that core does not already provide.

Delivered foundations:
- worker config block with `transport`, `endpoint`, `timeoutMs`, and `probe`
- health probe abstraction supporting:
  - loopback HTTP probe
  - local command probe
  - explicit `none`
- small client module: `src/worker-client.ts`
- evidence record type: `src/evidence.ts`
- safe command: `/miya-worker-health`
- stable desktop run route: `POST /plugins/miya/desktop/run`
- high-level desktop run tool: `miya_desktop_run`

Still missing:
- real worker server
- richer action semantics beyond the current minimal set

## Phase 2 — memory lite + persona lite

Goal: add small Miya-specific memory and persona helpers without replacing core memory systems.

Delivered foundations:
- `memoryLite` config, resolver, and status helper
- `personaLite` config, resolver, and status helper
- explicit fallback strategy docs in code:
  - memory-lite falls back to core/identity behavior
  - persona-lite falls back to static summary/reference assets
- local memory-lite recall against the Miya-side index
- dynamic persona block injection during `before_prompt_build`
- single-stage prompt assembly for runtime guard + persona + recall

Still missing:
- dynamic prompt injection hook, if OpenClaw exposes a stable surface for it
- memory writeback and recall curation policies

## Phase 3 — voice foundations

Goal: define voice-related config and map real local assets without pretending they already run.

Delivered foundations:
- config/types for `vad`, `asr`, `tts`, `speakerId`
- model mapping to local assets under `model/`
- diagnostics exposure through `/miya-probe` and `/miya-capabilities`
- real neural VAD execution path via `worker/voice_sidecar.py` with local Silero CUDA preference
- real ASR execution path via `worker/voice_sidecar.py` when `faster-whisper` is available
- real embedding-based speaker matching via `worker/voice_sidecar.py` and local `ERes2Net`
- real Qwen3-TTS synthesis path through local `qwen_tts` weights
- route/tool parity for runtime-state and evidence persistence

Still missing:
- richer neural VAD threshold/window controls and diarization-grade segmentation
- stronger speaker enrollment/threshold management instead of raw cosine-only matching

## Phase 4 — VRAM scheduler foundations

Goal: define scheduling intent before implementing any allocator.

Delivered foundations:
- declarative lane config
- priorities for `interactive`, `voice`, `vision`, `image`, `training`
- estimated VRAM reservation per lane
- action-level override for lightweight voice operations such as VAD
- example uses per lane
- persisted lane leases under `state/vram-scheduler.json`
- dead-process lease pruning on each admission attempt
- live GPU free-memory telemetry via `nvidia-smi`
- corrupt-state quarantine + atomic state writes so scheduler persistence does not silently rot
- lower-priority lane force-eviction when explicitly enabled
- persisted eviction records for real admissions
- optional external defrag hook when fragmentation risk is diagnosed

Still missing:
- real runtime coordination
- model load/unload policy implementation
- fragmentation-aware load/unload policies inside the actual model runtimes

## Phase 5 — wizard/training foundations

Goal: capture local training intent and descriptors without launching fake jobs.

Delivered foundations:
- wizard config
- wizard state type
- training job descriptor type
- persisted staged jobs under `state/wizard/jobs`
- wizard HTTP routes: `/plugins/miya/wizard/status|start|update`
- wizard tools: `miya_wizard_status|start_job|update_job|run_job`
- local runner execution for staged jobs, including persona-dataset manifest generation
- persona-dataset prep runs without taking a training GPU lease when no trainer command is configured
- external LoRA / finetune trainer profiles through `wizard.trainer`
- per-job trainer override contract for command / args / cwd / env / artifact globs
- dataset validation before runner spawn
- trainer adapter translation for generic-command and python-script contracts
- external trainer artifact manifest capture
- training lane cleanup after runner exit

Still missing:
- trainer-specific adapters beyond generic command-template execution

## Phase 6 — diagnostics, acceptance, and continuous-work control

Goal: make the project inspectable and honest.

Delivered foundations:
- consolidated diagnostics collector
- acceptance checklist
- validation doc
- capability/status commands
- queue-backed workflow commands:
  - `miya-workflow-start`
  - `miya-workflow-check`
  - `miya-workflow-stop`
- queue-backed workflow routes:
  - `/plugins/miya/workflow/check`
  - `/plugins/miya/workflow/start`
  - `/plugins/miya/workflow/stop`
- queue-backed workflow tools:
  - `miya_workflow_start`
  - `miya_workflow_check`
  - `miya_workflow_stop`
- dispatcher-backed continuation hooks

Still missing:
- live runtime acceptance run against a real worker and chosen model stack
- end-to-end runtime acceptance for force-eviction and trainer profiles on the target machine

## Explicit non-goals for this scaffold

- No custom channel implementation
- No replacement for built-in OpenClaw core features
- No fake claims about voice/image/vision execution
- No silent desktop control loop
- No Canvas feature claims yet
